using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using HarmonyLib;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace OniDataDump
{
	/// <summary>
	/// Serialises the game's material conversions. Every mechanism that turns one thing into
	/// another is listed under its own key so the app can reason about them separately:
	/// element phase changes, fabricator recipes, building converters and generators,
	/// critter diets / drops / eggs / molts, plant crops and consumption, geysers, toilets,
	/// and where worldgen places each element. Amounts are the game's own units (kg, kg/s,
	/// kcal); nothing is interpreted here.
	/// </summary>
	internal static class Dump
	{
		public static void WriteTo(string path)
		{
			var root = new JObject
			{
				["game"] = new JObject
				{
					["build"] = BuildWatermark.GetBuildText(),
					["dumpedAt"] = System.DateTime.UtcNow.ToString("o"),
					["activeDlcs"] = new JArray(DlcIds().Where(DlcManager.IsContentSubscribed)),
				},
				// Wild (pip-planted / untamed) versus domesticated: wild plants grow at this
				// fraction of the domestic rate and take no irrigation or fertiliser; wild
				// critters burn (and so eat and excrete) this fraction of the tame calories.
				["tuning"] = new JObject
				{
					["wildPlantGrowthModifier"] = TUNING.CROPS.WILD_GROWTH_RATE_MODIFIER,
					["wildCritterCalorieBurnRatio"] = TUNING.CREATURES.WILD_CALORIE_BURN_RATIO,
					["wildCritterGrowthModifier"] = TUNING.CREATURES.WILD_GROWTH_RATE_MODIFIER,
					["secondsPerCycle"] = 600f,
					// A Duplicant's bladder fills at this rate out of 100, so 1/6 per second is one
					// toilet visit per cycle. Showers are taken about as often.
					["bladderPerSecond"] = TUNING.DUPLICANTSTATS.STANDARD.BaseStats.BLADDER_INCREASE_PER_SECOND,
					// HappinessMonitor.REPRODUCTION_HAPPINESS_MULTIPLIER (private): a tame critter's egg rate
					// is multiplied by 1 + this * happiness while happiness is positive.
					["fertilityPerHappiness"] = 2.25f,
					// The sim only changes phase this many kelvin past lowTemp / highTemp.
					["stateTransitionBufferK"] = SimMessages.STATE_TRANSITION_TEMPERATURE_BUFER,
					// A Mimika's pollination: growth bonus, how long it lasts, and the pause between plants.
					// Kept for the app's older-dump path; every crop-tending critter now carries "tends".
					["pollination"] = new JObject
					{
						["growthBonus"] = ButterflyTuning.CROP_TENDED_MULTIPLIER_EFFECT,
						["effectSeconds"] = ButterflyTuning.CROP_TENDED_MULTIPLIER_DURATION,
						["searchCooldownSeconds"] = ButterflyTuning.SEARCH_COOLDOWN,
					},
					["farmTinker"] = FarmTinker(),
				},
				["dlcs"] = new JArray(DlcIds().Select(id => new JObject { ["id"] = id, ["name"] = DlcName(id) })),
				["names"] = Names(),
				["elements"] = Elements(),
				["items"] = Items(),
				["recipes"] = Recipes(),
				["buildings"] = Buildings(),
				["features"] = Features(),
				["fabricators"] = Fabricators(),
				["critters"] = Critters(),
				["plants"] = Plants(),
				["plantMutations"] = PlantMutations(),
				["geysers"] = Geysers(),
				["worldgen"] = Worldgen(),
				["clusters"] = Clusters(),
				["spacePois"] = SpacePois(),
				["spaceDestinations"] = SpaceDestinations(),
			};
			File.WriteAllText(path, root.ToString(Formatting.Indented));
		}

		/// <summary>Buildings the data refers to (fabricators and converters), so only their icons are written.</summary>
		private static readonly HashSet<string> usedBuildings = new HashSet<string>();

		// ---- icons ----

		/// <summary>
		/// The game's own UI sprite for every element, item, critter, plant, and used building,
		/// as a small PNG named by tag, plus index.json listing the tags written. Liquids and
		/// gases share one droplet / cloud sprite tinted with the element's colour, as in the
		/// game. Sprites live in atlases the CPU cannot read, so each atlas is copied through
		/// a render texture once.
		/// </summary>
		public static void WriteIcons(string dir, int maxSize = 64)
		{
			Directory.CreateDirectory(dir);
			var written = new JArray();
			var seen = new HashSet<string>();
			void Save(string tag, Tuple<Sprite, Color> ui)
			{
				if (ui?.first == null || !seen.Add(tag))
					return;
				try
				{
					File.WriteAllBytes(Path.Combine(dir, tag + ".png"), Png(ui.first, ui.second, maxSize));
					written.Add(tag);
				}
				catch (Exception e)
				{
					Debug.LogWarning("[OniDataDump] No icon for " + tag + ": " + e.Message);
				}
			}
			foreach (Element e in ElementLoader.elements)
				if (e != null && !e.disabled)
					Save(e.id.ToString(), Def.GetUISprite(e));
			foreach (KPrefabID id in ItemPrefabs())
				Save(id.PrefabTag.ToString(), Def.GetUISprite(id.gameObject));
			foreach (BuildingDef def in Assets.BuildingDefs)
				if (usedBuildings.Contains(def.PrefabID))
					Save(def.PrefabID, new Tuple<Sprite, Color>(def.GetUISprite(), Color.white));
			foreach (Texture2D copy in readable.Values)
				UnityEngine.Object.Destroy(copy);
			readable.Clear();
			File.WriteAllText(Path.Combine(dir, "index.json"), written.ToString(Formatting.None));
		}

		private static readonly Dictionary<Texture2D, Texture2D> readable = new Dictionary<Texture2D, Texture2D>();

		/// <summary>A CPU-readable copy of a (usually unreadable) atlas, made once per atlas.</summary>
		private static Texture2D Readable(Texture2D src)
		{
			if (readable.TryGetValue(src, out Texture2D copy))
				return copy;
			RenderTexture rt = RenderTexture.GetTemporary(src.width, src.height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
			RenderTexture previous = RenderTexture.active;
			Graphics.Blit(src, rt);
			RenderTexture.active = rt;
			copy = new Texture2D(src.width, src.height, TextureFormat.RGBA32, false);
			copy.ReadPixels(new Rect(0, 0, src.width, src.height), 0, 0);
			copy.Apply();
			RenderTexture.active = previous;
			RenderTexture.ReleaseTemporary(rt);
			readable[src] = copy;
			return copy;
		}

		/// <summary>The sprite's pixels, tinted, scaled down to fit maxSize with supersampling, as PNG.</summary>
		private static byte[] Png(Sprite sprite, Color tint, int maxSize)
		{
			Texture2D src = Readable(sprite.texture);
			Rect r;
			try { r = sprite.textureRect; } catch (Exception) { r = sprite.rect; }
			int w = Mathf.Max(1, Mathf.RoundToInt(r.width)), h = Mathf.Max(1, Mathf.RoundToInt(r.height));
			float scale = Mathf.Min(1f, maxSize / (float)Mathf.Max(w, h));
			int ow = Mathf.Max(1, Mathf.RoundToInt(w * scale)), oh = Mathf.Max(1, Mathf.RoundToInt(h * scale));
			int ss = Mathf.Max(1, Mathf.CeilToInt(1f / scale));
			var pixels = new Color[ow * oh];
			for (int y = 0; y < oh; y++)
				for (int x = 0; x < ow; x++)
				{
					Color sum = Color.clear;
					for (int sy = 0; sy < ss; sy++)
						for (int sx = 0; sx < ss; sx++)
						{
							float u = (r.x + (x + (sx + 0.5f) / ss) * w / ow) / src.width;
							float v = (r.y + (y + (sy + 0.5f) / ss) * h / oh) / src.height;
							sum += src.GetPixelBilinear(u, v);
						}
					pixels[y * ow + x] = sum / (ss * ss) * tint;
				}
			var tex = new Texture2D(ow, oh, TextureFormat.RGBA32, false);
			tex.SetPixels(pixels);
			tex.Apply();
			byte[] png = tex.EncodeToPNG();
			UnityEngine.Object.Destroy(tex);
			return png;
		}

		// ---- helpers ----

		/// <summary>"all-dlcs", "base", "no-spaced-out", or the active ids joined; mirrors tools/import-dump.py.</summary>
		public static string Flavour()
		{
			var all = DlcIds().ToList();
			var active = all.Where(id => DlcManager.IsContentSubscribed(id)).ToList();
			if (active.Count == all.Count)
				return "all-dlcs";
			if (active.Count == 0)
				return "base";
			if (active.Count == all.Count - 1 && !active.Contains(DlcManager.EXPANSION1_ID))
				return "no-spaced-out";
			return string.Join("+", active.Select(id => id.Replace("_ID", "").ToLowerInvariant()));
		}

		private static IEnumerable<string> DlcIds()
		{
			return new[] { DlcManager.EXPANSION1_ID, DlcManager.DLC2_ID, DlcManager.DLC3_ID, DlcManager.DLC4_ID, DlcManager.DLC5_ID };
		}

		private static string DlcName(string id)
		{
			try { return Plain(DlcManager.GetDlcTitle(id)); }
			catch { return id; }
		}

		private static JArray Dlc(string[] required, string[] forbidden = null)
		{
			var o = new JArray(required ?? new string[0]);
			return o;
		}

		private static JObject Restrictions(IHasDlcRestrictions r)
		{
			return new JObject
			{
				["requires"] = new JArray(r?.GetRequiredDlcIds() ?? new string[0]),
				["forbids"] = new JArray(r?.GetForbiddenDlcIds() ?? new string[0]),
			};
		}

		private static JObject Restrictions(KPrefabID id)
		{
			return new JObject
			{
				["requires"] = new JArray(id?.requiredDlcIds ?? new string[0]),
				["forbids"] = new JArray(id?.forbiddenDlcIds ?? new string[0]),
			};
		}

		/// <summary>Display text without Klei's rich-text markup (link, colour, italics).</summary>
		private static string Plain(string text)
		{
			return string.IsNullOrEmpty(text) ? text : System.Text.RegularExpressions.Regex.Replace(text, "<[^>]+>", "").Trim();
		}

		private static JObject Amount(Tag tag, float amount)
		{
			return new JObject { ["tag"] = tag.ToString(), ["amount"] = amount };
		}

		// ---- sections ----

		/// <summary>
		/// The game's display name for every tag the other sections mention: elements, all
		/// prefabs (items, critters, plants, eggs), and all buildings (so fabricator ids in
		/// recipes resolve). The UI shows these, never the ids: "PlantFiber" is "Plant Husk".
		/// </summary>
		private static JObject Names()
		{
			var names = new JObject();
			foreach (Element e in ElementLoader.elements)
				if (e != null && !string.IsNullOrEmpty(e.name))
					names[e.id.ToString()] = Plain(e.name);
			foreach (KPrefabID id in Assets.Prefabs)
			{
				string name = Plain(id.gameObject.GetProperName());
				if (!string.IsNullOrEmpty(name) && names[id.PrefabTag.ToString()] == null)
					names[id.PrefabTag.ToString()] = name;
			}
			foreach (BuildingDef def in Assets.BuildingDefs)
				if (!string.IsNullOrEmpty(def.Name))
					names[def.PrefabID] = Plain(def.Name);
			return names;
		}

		private static JArray Elements()
		{
			var arr = new JArray();
			foreach (Element e in ElementLoader.elements)
			{
				if (e == null)
					continue;
				var o = new JObject
				{
					["id"] = e.id.ToString(),
					["name"] = Plain(e.name),
					["state"] = e.IsSolid ? "solid" : e.IsLiquid ? "liquid" : e.IsGas ? "gas" : "other",
					["dlc"] = e.dlcId ?? "",
					["disabled"] = e.disabled,
					["materialCategory"] = e.materialCategory.ToString(),
					["tags"] = new JArray(e.oreTags.Select(t => t.ToString())),
					["lowTemp"] = e.lowTemp,
					["highTemp"] = e.highTemp,
					["lowTempTarget"] = e.lowTempTransitionTarget.ToString(),
					["highTempTarget"] = e.highTempTransitionTarget.ToString(),
				};
				if (e.highTempTransitionOreID != SimHashes.Vacuum)
					o["highTempOre"] = new JObject { ["id"] = e.highTempTransitionOreID.ToString(), ["massFraction"] = e.highTempTransitionOreMassConversion };
				if (e.lowTempTransitionOreID != SimHashes.Vacuum)
					o["lowTempOre"] = new JObject { ["id"] = e.lowTempTransitionOreID.ToString(), ["massFraction"] = e.lowTempTransitionOreMassConversion };
				if (e.sublimateId != SimHashes.Vacuum && e.sublimateId != 0)
					o["sublimate"] = new JObject { ["id"] = e.sublimateId.ToString(), ["rate"] = e.sublimateRate, ["efficiency"] = e.sublimateEfficiency };
				else
				{
					// Some ores off-gas as debris instead (Bleach Stone's chlorine): a Sublimates component on
					// the element's prefab, converting mass one to one at rate * mass^massPower per second,
					// stopping when the gas around it reaches maxDestinationMass.
					GameObject ore = Assets.TryGetPrefab(e.tag);
					Sublimates debris = ore != null ? ore.GetComponent<Sublimates>() : null;
					if (debris != null && debris.info.sublimatedElement != SimHashes.Vacuum)
						o["sublimate"] = new JObject
						{
							["id"] = debris.info.sublimatedElement.ToString(),
							["rate"] = debris.info.sublimationRate,
							["efficiency"] = 1f,
							["debris"] = true,
							["massPower"] = debris.info.massPower,
							["maxDestinationMass"] = debris.info.maxDestinationMass,
						};
				}
				if (e.convertId != SimHashes.Vacuum && e.convertId != 0)
					o["convertId"] = e.convertId.ToString();
				arr.Add(o);
			}
			return arr;
		}

		/// <summary>Prefabs that are things rather than buildings or elements: food, seeds, eggs, shells, critters, plants.</summary>
		private static IEnumerable<KPrefabID> ItemPrefabs()
		{
			foreach (KPrefabID id in Assets.Prefabs)
			{
				GameObject prefab = id.gameObject;
				if (prefab.GetComponent<BuildingComplete>() != null || prefab.GetComponent<PrimaryElement>() == null)
					continue;
				if (ElementLoader.GetElement(id.PrefabTag) != null)
					continue;
				yield return id;
			}
		}

		/// <summary>Non-element things that recipes, diets, and drops refer to: food, seeds, eggs, shells, critters.</summary>
		private static JArray Items()
		{
			var arr = new JArray();
			foreach (KPrefabID id in ItemPrefabs())
			{
				GameObject prefab = id.gameObject;
				var o = new JObject
				{
					["id"] = id.PrefabTag.ToString(),
					["name"] = Plain(prefab.GetProperName()),
					["tags"] = new JArray(id.Tags.Select(t => t.ToString())),
					["dlc"] = Restrictions(id),
					["kind"] = prefab.GetComponent<Edible>() != null ? "food"
						: prefab.GetComponent<PlantableSeed>() != null ? "seed"
						: prefab.GetDef<IncubationMonitor.Def>() != null || id.HasTag(GameTags.Egg) ? "egg"
						: prefab.GetComponent<CreatureBrain>() != null ? "critter"
						: prefab.GetComponent<Crop>() != null || prefab.GetComponent<Growing>() != null ? "plant"
						: "item",
				};
				Edible edible = prefab.GetComponent<Edible>();
				if (edible != null)
					o["calories"] = edible.FoodInfo?.CaloriesPerUnit ?? 0f;
				// Food that can rot carries a Rottable def; it becomes a Rot Pile of the same mass.
				Rottable.Def rot = prefab.GetDef<Rottable.Def>();
				if (rot != null && rot.spoilTime > 0f)
					o["spoilSeconds"] = rot.spoilTime;
				Sublimates sublimates = prefab.GetComponent<Sublimates>();
				if (sublimates != null)
					o["sublimates"] = new JObject { ["element"] = sublimates.info.sublimatedElement.ToString(), ["rate"] = sublimates.info.sublimationRate };
				arr.Add(o);
			}
			return arr;
		}

		private static JArray Recipes()
		{
			var arr = new JArray();
			foreach (ComplexRecipe r in ComplexRecipeManager.Get().recipes)
			{
				var o = new JObject
				{
					["id"] = r.id,
					["fabricators"] = new JArray(r.fabricators.Select(f => f.ToString())),
					["time"] = r.time,
					["ingredients"] = new JArray(r.ingredients.Select(i => new JObject
					{
						["options"] = new JArray(i.possibleMaterials.Select((m, k) => Amount(m, i.possibleMaterialAmounts != null && k < i.possibleMaterialAmounts.Length ? i.possibleMaterialAmounts[k] : i.amount))),
						["doNotConsume"] = i.doNotConsume,
					})),
					["results"] = new JArray(r.results.Select(x => Amount(x.material, x.amount))),
				};
				if (r.consumedHEP > 0) o["radboltsIn"] = r.consumedHEP;
				if (r.producedHEP > 0) o["radboltsOut"] = r.producedHEP;
				foreach (Tag f in r.fabricators)
					usedBuildings.Add(f.ToString());
				arr.Add(o);
			}
			return arr;
		}

		/// <summary>
		/// Every fabricator, with whether a Duplicant has to stand at it for the whole craft (a
		/// Rock Crusher) or only loads it (a Kiln runs on its own), which is what its throughput
		/// costs the colony.
		/// </summary>
		private static JArray Fabricators()
		{
			var arr = new JArray();
			foreach (BuildingDef def in Assets.BuildingDefs)
			{
				ComplexFabricator fab = def.BuildingComplete?.GetComponent<ComplexFabricator>();
				if (fab == null)
					continue;
				arr.Add(new JObject { ["id"] = def.PrefabID, ["duplicantOperated"] = fab.duplicantOperated });
			}
			return arr;
		}

		/// <summary>Buildings with any continuous conversion: ElementConverter, generator fuel, consumers, emitters, toilets.</summary>
		private static JArray Buildings()
		{
			var arr = new JArray();
			foreach (BuildingDef def in Assets.BuildingDefs)
			{
				GameObject go = def.BuildingComplete;
				if (go == null)
					continue;
				var inputs = new JArray();
				var outputs = new JArray();
				// A Shower's converter only runs while a Duplicant is in it, five seconds at a
				// kilogram a second, so it is a per-use building like a toilet.
				bool shower = go.GetComponent<Shower>() != null;
				foreach (ElementConverter c in go.GetComponents<ElementConverter>())
				{
					foreach (var ce in c.consumedElements ?? new ElementConverter.ConsumedElement[0])
						inputs.Add(shower
							? new JObject { ["tag"] = ce.Tag.ToString(), ["amountPerUse"] = Shower.WATER_PER_USE, ["via"] = "Shower" }
							: new JObject { ["tag"] = ce.Tag.ToString(), ["rate"] = ce.MassConsumptionRate, ["via"] = "ElementConverter" });
					foreach (var oe in c.outputElements ?? new ElementConverter.OutputElement[0])
						outputs.Add(shower
							? new JObject { ["tag"] = oe.elementHash.ToString(), ["amountPerUse"] = Shower.WATER_PER_USE * oe.massGenerationRate, ["via"] = "Shower" }
							: new JObject { ["tag"] = oe.elementHash.ToString(), ["rate"] = oe.massGenerationRate, ["via"] = "ElementConverter" });
				}
				EnergyGenerator gen = go.GetComponent<EnergyGenerator>();
				if (gen != null && gen.formula.inputs != null)
				{
					foreach (var i in gen.formula.inputs)
						inputs.Add(new JObject { ["tag"] = i.tag.ToString(), ["rate"] = i.consumptionRate, ["via"] = "EnergyGenerator" });
					foreach (var x in gen.formula.outputs ?? new EnergyGenerator.OutputItem[0])
						outputs.Add(new JObject { ["tag"] = x.element.ToString(), ["rate"] = x.creationRate, ["via"] = "EnergyGenerator" });
				}
				foreach (ElementConsumer c in go.GetComponents<ElementConsumer>())
					inputs.Add(new JObject { ["tag"] = c.elementToConsume.ToString(), ["rate"] = c.consumptionRate, ["via"] = "ElementConsumer" });
				foreach (ElementEmitter em in go.GetComponents<ElementEmitter>())
					outputs.Add(new JObject { ["tag"] = em.outputElement.elementHash.ToString(), ["rate"] = em.outputElement.massGenerationRate, ["via"] = "ElementEmitter" });
				foreach (BuildingElementEmitter em in go.GetComponents<BuildingElementEmitter>())
					outputs.Add(new JObject { ["tag"] = em.element.ToString(), ["rate"] = em.emitRate, ["via"] = "BuildingElementEmitter" });
				Toilet toilet = go.GetComponent<Toilet>();
				if (toilet != null)
					outputs.Add(new JObject { ["tag"] = toilet.solidWastePerUse.elementID.ToString(), ["amountPerUse"] = toilet.solidWastePerUse.mass, ["via"] = "Toilet" });
				SteamTurbine turbine = go.GetComponent<SteamTurbine>();
				if (turbine != null)
				{
					// The turbine idles below minActiveTemperature (125 C): steam straight off boiling water is too cool.
					inputs.Add(new JObject { ["tag"] = turbine.srcElem.ToString(), ["rate"] = turbine.pumpKGRate, ["via"] = "SteamTurbine", ["minTemperatureK"] = turbine.minActiveTemperature });
					outputs.Add(new JObject { ["tag"] = turbine.destElem.ToString(), ["rate"] = turbine.pumpKGRate, ["via"] = "SteamTurbine" });
				}
				FlushToilet flush = go.GetComponent<FlushToilet>();
				if (flush != null)
				{
					inputs.Add(new JObject { ["tag"] = "Water", ["amountPerUse"] = flush.massConsumedPerUse, ["via"] = "FlushToilet" });
					outputs.Add(new JObject { ["tag"] = "DirtyWater", ["amountPerUse"] = flush.massEmittedPerUse, ["via"] = "FlushToilet" });
				}
				// An Oil Well stores natural gas as it pumps, released when a Duplicant depressurises it.
				OilWellCap well = go.GetComponent<OilWellCap>();
				if (well != null)
					outputs.Add(new JObject { ["tag"] = well.gasElement.ToString(), ["rate"] = well.addGasRate, ["via"] = "OilWellCap" });
				if (inputs.Count == 0 && outputs.Count == 0)
					continue;
				usedBuildings.Add(def.PrefabID);
				var o = new JObject
				{
					["id"] = def.PrefabID,
					["name"] = Plain(def.Name),
					["dlc"] = new JObject { ["requires"] = new JArray(def.RequiredDlcIds ?? new string[0]), ["forbids"] = new JArray(def.ForbiddenDlcIds ?? new string[0]) },
					["inputs"] = inputs,
					["outputs"] = outputs,
				};
				// Whether the building takes its input from, and sends its product down, a pipe
				// (a Lavatory) rather than the world (a Wall Toilet drops its polluted water).
				if (def.InputConduitType != ConduitType.None)
					o["inputConduit"] = def.InputConduitType.ToString();
				if (def.OutputConduitType != ConduitType.None)
					o["outputConduit"] = def.OutputConduitType.ToString();
				// A building that has to sit on a terrain feature (an Oil Well on an Oil Reservoir).
				string host = def.AttachmentSlotTag.IsValid ? FeatureFor(def.AttachmentSlotTag) : null;
				if (host != null)
					o["attachesTo"] = host;
				arr.Add(o);
			}
			return arr;
		}

		/// <summary>
		/// Terrain features buildings attach to (an Oil Reservoir, a Thermal Gas Fissure): placed
		/// entities with hard points for a building, as opposed to buildings with hard points.
		/// </summary>
		private static List<GameObject> featurePrefabs;

		private static List<GameObject> FeaturePrefabs()
		{
			if (featurePrefabs == null)
				featurePrefabs = Assets.GetPrefabsWithComponent<BuildingAttachPoint>()
					.Where(go => go.GetComponent<Building>() == null && go.GetComponent<KPrefabID>() != null)
					.ToList();
			return featurePrefabs;
		}

		private static bool IsFeature(string id)
		{
			return FeaturePrefabs().Any(go => go.GetComponent<KPrefabID>().PrefabTag.Name == id);
		}

		/// <summary>The feature prefab with a hard point for this attachment slot, if any.</summary>
		private static string FeatureFor(Tag slot)
		{
			foreach (GameObject go in FeaturePrefabs())
			{
				BuildingAttachPoint ap = go.GetComponent<BuildingAttachPoint>();
				if ((ap.points ?? new BuildingAttachPoint.HardPoint[0]).Any(pt => pt.attachableType == slot))
					return go.GetComponent<KPrefabID>().PrefabTag.Name;
			}
			return null;
		}

		/// <summary>
		/// Terrain features buildings sit on, with what a fissure does: it bubbles gas while it
		/// builds up, then blocks until its drill (the building on it) clears it, which drops a
		/// solid. Where worlds place them is in each world's template rules, like geysers.
		/// </summary>
		private static JArray Features()
		{
			var arr = new JArray();
			foreach (GameObject go in FeaturePrefabs())
			{
				KPrefabID id = go.GetComponent<KPrefabID>();
				var o = new JObject
				{
					["id"] = id.PrefabTag.Name,
					["name"] = Plain(go.GetProperName()),
					["dlc"] = Restrictions(id),
				};
				UnderwaterVent.Def vent = go.GetComponent<StateMachineController>()?.GetDef<UnderwaterVent.Def>();
				if (vent != null)
				{
					UnderwaterVent.Data data = vent.data;
					var slots = (go.GetComponent<BuildingAttachPoint>().points ?? new BuildingAttachPoint.HardPoint[0]).Select(pt => pt.attachableType).ToList();
					JObject drill = null;
					foreach (BuildingDef def in Assets.BuildingDefs)
					{
						if (def.BuildingComplete == null || !slots.Contains(def.AttachmentSlotTag))
							continue;
						UnderwaterVentDrill.Def dd = def.BuildingComplete.GetComponent<StateMachineController>()?.GetDef<UnderwaterVentDrill.Def>();
						if (dd == null)
							continue;
						usedBuildings.Add(def.PrefabID);
						drill = new JObject
						{
							["building"] = def.PrefabID,
							["input"] = dd.DiamondTag.ToString(),
							["ratePerSecond"] = dd.DiamondConsumptionRate,
							["seconds"] = dd.WorkDuration,
						};
						break;
					}
					o["vent"] = new JObject
					{
						["bubbleElement"] = data.BubbleElement.ToString(),
						["bubbleRatePerSecond"] = data.BubbleMassRate,
						["buildUpSeconds"] = data.BuildUpDuration,
						["solidElement"] = data.SolidElement.ToString(),
						["solidMass"] = data.SolidMass,
						["drill"] = drill,
					};
				}
				arr.Add(o);
			}
			return arr;
		}

		private static JArray Critters()
		{
			var arr = new JArray();
			foreach (GameObject prefab in Assets.GetPrefabsWithComponent<CreatureBrain>())
			{
				KPrefabID id = prefab.GetComponent<KPrefabID>();
				var o = new JObject
				{
					["id"] = id.PrefabTag.ToString(),
					["name"] = Plain(prefab.GetProperName()),
					["dlc"] = Restrictions(id),
				};
				CreatureCalorieMonitor.Def calories = prefab.GetDef<CreatureCalorieMonitor.Def>();
				if (calories?.diet?.infos != null)
				{
					o["diet"] = new JArray(calories.diet.infos.Select(info => new JObject
					{
						["eats"] = new JArray(info.consumedTags.Select(t => t.ToString())),
						["produces"] = info.producedElement.ToString(),
						["caloriesPerKg"] = info.caloriesPerKg,
						["producedPerKgEaten"] = info.producedConversionRate,
					}));
				}
				// Tame metabolism from the critter's base trait: kcal burned per cycle and stomach
				// size. Wild critters burn tuning.wildCritterCalorieBurnRatio of this.
				Klei.AI.Modifiers modifiers = prefab.GetComponent<Klei.AI.Modifiers>();
				if (modifiers != null && modifiers.initialTraits != null)
				{
					string calorieDelta = Db.Get().Amounts.Calories.deltaAttribute.Id;
					string calorieMax = Db.Get().Amounts.Calories.maxAttribute.Id;
					string ageMax = Db.Get().Amounts.Age.maxAttribute.Id;
					foreach (string traitId in modifiers.initialTraits)
					{
						Klei.AI.Trait trait = Db.Get().traits.TryGet(traitId);
						if (trait == null)
							continue;
						foreach (Klei.AI.AttributeModifier m in trait.SelfModifiers)
						{
							if (m.AttributeId == calorieDelta)
								o["caloriesBurnedPerCycle"] = -m.Value * 600f;
							else if (m.AttributeId == calorieMax)
								o["stomachCalories"] = m.Value;
							else if (m.AttributeId == ageMax)
								o["lifespanCycles"] = m.Value; // it dies of old age after this many cycles
						}
					}
				}
				Butcherable butcherable = prefab.GetComponent<Butcherable>();
				if (butcherable?.drops != null)
					o["deathDrops"] = new JArray(butcherable.drops.Select(d => new JObject { ["tag"] = d.Key, ["count"] = d.Value }));
				FertilityMonitor.Def fertility = prefab.GetDef<FertilityMonitor.Def>();
				if (fertility != null)
				{
					o["egg"] = fertility.eggPrefab.ToString();
					o["cyclesPerEgg"] = fertility.baseFertileCycles;
				}
				BabyMonitor.Def baby = prefab.GetDef<BabyMonitor.Def>();
				if (baby != null)
				{
					o["adult"] = baby.adultPrefab.ToString();
					if (!string.IsNullOrEmpty(baby.onGrowDropID))
						o["growDrop"] = baby.onGrowDropID;
				}
				ScaleGrowthMonitor.Def scales = prefab.GetDef<ScaleGrowthMonitor.Def>();
				if (scales != null)
				{
					// Scale growth runs at defaultGrowthRate * 100 per second out of 100, so a tame
					// critter is shearable every 1/defaultGrowthRate seconds; wild ones grow at a quarter.
					o["shear"] = new JObject
					{
						["item"] = scales.itemDroppedOnShear.ToString(),
						["atmosphere"] = scales.targetAtmosphere.ToString(),
						["mass"] = scales.dropMass,
						["seconds"] = scales.defaultGrowthRate > 0f ? 1f / scales.defaultGrowthRate : 0f,
					};
				}
				// Calorie-driven milking (Gassy Moo, Husky Moo, Glo Squid): eating extends a well-fed
				// effect that raises the MilkProduction amount by ratePercentPerSecond out of 100; at
				// 100 the critter asks for a Milking Station, which drains capacity kg of the element.
				// Each caloriesPerCycle kcal eaten buys 600 s of the effect.
				MilkProductionMonitor.Def milk = prefab.GetDef<MilkProductionMonitor.Def>();
				if (milk != null)
				{
					// The Gassy Moo leaves effectId null and gets the effect from its beckoning monitor.
					string effectId = milk.effectId ?? prefab.GetDef<BeckoningMonitor.Def>()?.effectId;
					o["milk"] = new JObject
					{
						["element"] = milk.element.ToString(),
						["capacity"] = milk.Capacity,
						["caloriesPerCycle"] = milk.CaloriesPerCycle,
						["effect"] = effectId,
						["ratePercentPerSecond"] = EffectDelta(effectId, Db.Get().Amounts.MilkProduction),
					};
				}
				// Fertility-driven milking (Seaquine): a milking drops dropMass kg of the element and
				// spends fertilityConsumed of the fertility bar, so it costs eggs. Only above minFertility.
				FertilityShearable.Def fertilityMilk = prefab.GetDef<FertilityShearable.Def>();
				if (fertilityMilk != null)
				{
					o["fertilityMilk"] = new JObject
					{
						["element"] = fertilityMilk.milkElement.ToString(),
						["mass"] = fertilityMilk.dropMass,
						["minFertility"] = fertilityMilk.minimumFertility,
						["fertilityConsumed"] = fertilityMilk.percentFertilityConsumedPerMilking,
						["requiresHappy"] = fertilityMilk.requiresHappy,
					};
				}
				// Well-fed shearables (Flox antlers, Shatter Flox glass, Rhex feathers, Orehull shell,
				// Bammoth fibre, Regal Bammoth gold): the same well-fed effect raises ScaleGrowth, and
				// at full growth (growthCycles of being fed) the critter is sheared for mass kg of the item.
				// requiredDiet, when set, is the only food that counts.
				WellFedShearable.Def wellFed = prefab.GetDef<WellFedShearable.Def>();
				if (wellFed != null)
				{
					o["wellFedShear"] = new JObject
					{
						["item"] = wellFed.itemDroppedOnShear.ToString(),
						["mass"] = wellFed.dropMass,
						["growthCycles"] = wellFed.growthDurationCycles,
						["levels"] = wellFed.levelCount,
						["caloriesPerCycle"] = wellFed.caloriesPerCycle,
						["effect"] = wellFed.effectId,
						["ratePercentPerSecond"] = EffectDelta(wellFed.effectId, Db.Get().Amounts.ScaleGrowth),
						["requiredDiet"] = wellFed.requiredDiet != null && wellFed.requiredDiet != Tag.Invalid ? wellFed.requiredDiet.ToString() : null,
					};
				}
				// Crop tending (a Mimika pollinating, a Sweetle or Grubgrub tending): each visit gives
				// the plant an effect that multiplies its growth for a while, then the critter waits
				// before looking for the next plant.
				JObject tends = Tends(prefab);
				if (tends != null)
					o["tends"] = tends;
				arr.Add(o);
			}
			return arr;
		}

		/// <summary>
		/// The per-second change an effect applies to an amount (its delta attribute), or 0 when
		/// the effect is unknown or does not touch it.
		/// </summary>
		private static float EffectDelta(string effectId, Klei.AI.Amount amount)
		{
			if (string.IsNullOrEmpty(effectId))
				return 0f;
			Klei.AI.Effect effect = Db.Get().effects.TryGet(effectId);
			if (effect == null)
				return 0f;
			string deltaId = amount.deltaAttribute.Id;
			return effect.SelfModifiers.Where(m => m.AttributeId == deltaId && !m.IsMultiplier).Sum(m => m.Value);
		}

		/// <summary>
		/// How much faster a plant grows under an effect: the multiplier the effect puts on the
		/// Maturity delta (0.25 = +25%), or 0 when the effect is unknown or does not touch it.
		/// </summary>
		private static float GrowthBonus(Klei.AI.Effect effect)
		{
			if (effect == null)
				return 0f;
			string deltaId = Db.Get().Amounts.Maturity.deltaAttribute.Id;
			return effect.SelfModifiers.Where(m => m.AttributeId == deltaId && m.IsMultiplier).Sum(m => m.Value);
		}

		/// <summary>
		/// A critter's crop tending. A Mimika (PollinateMonitor) gives ButterflyPollinated and
		/// waits SEARCH_COOLDOWN before the next plant. A Sweetle or Grubgrub carries a
		/// CropTendingMonitor (how many plants a cycle) and, in its chore table rather than among
		/// its defs, the CropTendingStates with the effect it gives and the plants it goes to
		/// first (interests: the Spindly Grubfruit Plant); babies have the monitor but not the
		/// chore, so they tend nothing.
		/// </summary>
		private static JObject Tends(GameObject prefab)
		{
			if (prefab.GetDef<PollinateMonitor.Def>() != null)
				return Tends(ButterflyTuning.POLLINATED_EFFECT, 600f / ButterflyTuning.SEARCH_COOLDOWN, null);
			CropTendingMonitor.Def monitor = prefab.GetDef<CropTendingMonitor.Def>();
			ChoreTable table = prefab.GetComponent<ChoreConsumer>()?.choreTable;
			if (monitor == null || table == null)
				return null;
			var entries = AccessTools.Field(typeof(ChoreTable), "entries")?.GetValue(table) as ChoreTable.Entry[];
			CropTendingStates.Def states = entries?.Select(e => e.stateMachineDef).OfType<CropTendingStates.Def>().FirstOrDefault();
			if (states == null)
				return null;
			var prefers = states.interests.OrderByDescending(kv => kv.Value).Select(kv => kv.Key.ToString()).ToList();
			return Tends(states.effectId, monitor.numCropsTendedPerCycle, prefers);
		}

		private static JObject Tends(string effectId, float plantsPerCycle, List<string> prefers)
		{
			Klei.AI.Effect effect = Db.Get().effects.TryGet(effectId);
			if (effect == null)
				return null;
			var o = new JObject
			{
				["effect"] = effectId,
				["growthBonus"] = GrowthBonus(effect),
				["effectSeconds"] = effect.duration,
				["plantsPerCycle"] = plantsPerCycle,
			};
			if (prefers != null && prefers.Count > 0)
				o["prefers"] = new JArray(prefers);
			return o;
		}

		/// <summary>
		/// Farmer's Touch from a Farm Station: a Duplicant with the CanFarmTinker perk turns
		/// massPerTinker kg of the station's material (Fertilizer) into one tool (the
		/// "Micronutrient Fertilizer" item) and applies it to a plant in a Farm room, which gets
		/// the FarmTinker effect: its Maturity delta multiplied by 1 + growthBonus for the effect's
		/// duration, lengthened by botanistBonus per point of the Duplicant's Botanist attribute.
		/// The station's and the plant's numbers are read from their components, the effect's
		/// from the Db, where the game's effects table put it.
		/// </summary>
		/// <summary>
		/// The station's tool time is set by its config's prefabInitFn (15 s for the Farm Station),
		/// which runs on each instance, not on the template; the template still carries the
		/// component default (160 s). Run the callback on a throwaway inactive clone and read it there.
		/// </summary>
		private static float ToolSeconds(TinkerStation station)
		{
			try
			{
				GameObject clone = UnityEngine.Object.Instantiate(station.gameObject);
				clone.SetActive(false);
				// prefabInitFn is an event, and Instantiate does not copy delegates, so the callback
				// is read from the template's KPrefabID (as KPrefabID.CopyInitFunctions does) and run
				// on the clone.
				KPrefabID template = station.GetComponent<KPrefabID>();
				Delegate init = template != null ? AccessTools.Field(typeof(KPrefabID), "prefabInitFn")?.GetValue(template) as Delegate : null;
				init?.DynamicInvoke(clone);
				float seconds = clone.GetComponent<TinkerStation>().toolProductionTime;
				UnityEngine.Object.DestroyImmediate(clone);
				return seconds;
			}
			catch (Exception e)
			{
				Debug.LogWarning("[OniDataDump] cannot run the tinker station's prefab init: " + e.Message);
				return station.toolProductionTime;
			}
		}

		private static JObject FarmTinker()
		{
			TinkerStation station = Assets.GetBuildingDef(FarmStationConfig.ID)?.BuildingComplete?.GetComponent<TinkerStation>();
			if (station == null)
				return null;
			Tinkerable plant = Assets.GetPrefabsWithComponent<Tinkerable>()
				.Select(p => p.GetComponent<Tinkerable>())
				.FirstOrDefault(t => t.tinkerMaterialTag == station.outputPrefab);
			if (plant == null)
				return null;
			Klei.AI.Effect effect = Db.Get().effects.TryGet(plant.addedEffect);
			return new JObject
			{
				["material"] = station.inputMaterial.ToString(),
				["fertilizerKg"] = station.massPerTinker * plant.tinkerMaterialAmount,
				["tool"] = station.outputPrefab.ToString(),
				["growthBonus"] = GrowthBonus(effect),
				["effectSeconds"] = effect?.duration ?? 0f,
				["botanistBonus"] = plant.effectMultiplier,
				["toolSeconds"] = ToolSeconds(station),
				["workSeconds"] = plant.GetWorkTime(),
			};
		}

		/// <summary>
		/// Radiation mutations a seed can carry: each scales the plant's yield, growth time, and
		/// water or fertilizer use, may add a bonus crop per harvest, and needs radiation (and
		/// sometimes light) to stay viable. Multipliers are given as the game applies them
		/// (yield 0.5 means x1.5). The "original" entry is the unmutated plant and is skipped.
		/// </summary>
		private static JArray PlantMutations()
		{
			var arr = new JArray();
			// Mutations came with Spaced Out; without it the table is absent.
			if (Db.Get().PlantMutations == null || Db.Get().PlantAttributes == null)
				return arr;
			string yieldId = Db.Get().PlantAttributes.YieldAmount.Id;
			string usageId = Db.Get().PlantAttributes.FertilizerUsageMod.Id;
			string growthId = Db.Get().Amounts.Maturity.maxAttribute.Id;
			string radiationId = Db.Get().PlantAttributes.MinRadiationThreshold.Id;
			string luxId = Db.Get().PlantAttributes.MinLightLux.Id;
			foreach (Klei.AI.PlantMutation m in Db.Get().PlantMutations.resources)
			{
				if (m.originalMutation)
					continue;
				var o = new JObject { ["id"] = m.Id, ["name"] = Plain(m.Name) };
				foreach (Klei.AI.AttributeModifier mod in m.SelfModifiers)
				{
					if (mod.AttributeId == yieldId && mod.IsMultiplier) o["yield"] = mod.Value;
					else if (mod.AttributeId == usageId && mod.IsMultiplier) o["usage"] = mod.Value;
					else if (mod.AttributeId == growthId && mod.IsMultiplier) o["growth"] = mod.Value;
					else if (mod.AttributeId == radiationId) o["minRadiation"] = mod.Value;
					else if (mod.AttributeId == luxId) o["minLux"] = mod.Value;
				}
				// The bonus crop is a private pair of fields.
				var bonus = HarmonyLib.Traverse.Create(m);
				Tag bonusTag = bonus.Field("bonusCropID").GetValue<Tag>();
				float bonusAmount = bonus.Field("bonusCropAmount").GetValue<float>();
				if (bonusTag.IsValid && bonusAmount > 0f)
					o["bonusCrop"] = new JObject { ["tag"] = bonusTag.ToString(), ["amount"] = bonusAmount };
				if (m.requiredPrefabIDs.Count > 0)
					o["onlyFor"] = new JArray(m.requiredPrefabIDs);
				if (m.restrictedPrefabIDs.Count > 0)
					o["notFor"] = new JArray(m.restrictedPrefabIDs);
				arr.Add(o);
			}
			return arr;
		}

		private static JArray Plants()
		{
			var arr = new JArray();
			// A tree's branches are prefabs of their own (ForestTreeBranch, SpaceTreeBranch) that
			// grow and are harvested one by one; they are not plants a player places, so they are
			// folded into their trunk below and skipped here.
			var branchPrefabs = new HashSet<string>();
			foreach (KPrefabID id in Assets.Prefabs)
			{
				PlantBranchGrower.Def grower = id.gameObject.GetDef<PlantBranchGrower.Def>();
				if (grower?.BRANCH_PREFAB_NAME != null)
					branchPrefabs.Add(grower.BRANCH_PREFAB_NAME);
			}
			foreach (GameObject prefab in Assets.GetPrefabsWithComponent<Growing>())
			{
				KPrefabID id = prefab.GetComponent<KPrefabID>();
				if (branchPrefabs.Contains(id.PrefabTag.ToString()))
					continue;
				var o = new JObject
				{
					["id"] = id.PrefabTag.ToString(),
					["name"] = Plain(prefab.GetProperName()),
					["dlc"] = Restrictions(id),
				};
				Crop crop = prefab.GetComponent<Crop>();
				if (crop != null)
					o["crop"] = new JObject { ["item"] = crop.cropVal.cropId, ["durationSeconds"] = crop.cropVal.cropDuration, ["count"] = crop.cropVal.numProduced };
				// A trunk that grows branches: each branch bears its own crop, and up to
				// MAX_BRANCH_COUNT of them grow at once, so the tree's harvest is the branch's times
				// that. An Arbor Tree's trunk is not harvestable itself (its Crop is the template
				// the branches copy), so the branch harvest is the tree's crop; a Bonbon Tree's trunk
				// gives nectar and its branches wood, two harvests on one plant.
				PlantBranchGrower.Def branches = prefab.GetDef<PlantBranchGrower.Def>();
				GameObject branch = branches?.BRANCH_PREFAB_NAME != null ? Assets.GetPrefab(branches.BRANCH_PREFAB_NAME) : null;
				Crop branchCrop = branch != null ? branch.GetComponent<Crop>() : null;
				if (branchCrop != null)
				{
					int count = branches.MAX_BRANCH_COUNT >= 0 && branches.BRANCH_OFFSETS != null ? Math.Min(branches.MAX_BRANCH_COUNT, branches.BRANCH_OFFSETS.Length) : branches.MAX_BRANCH_COUNT;
					var harvest = new JObject { ["item"] = branchCrop.cropVal.cropId, ["durationSeconds"] = branchCrop.cropVal.cropDuration, ["count"] = branchCrop.cropVal.numProduced * count };
					o["branches"] = count;
					// The Arbor Tree's trunk carries the same WoodLog crop its branches copy and is not
					// harvested itself; the Bonbon Tree's trunk has a crop of its own (nectar). Its
					// Harvestable is added per instance, so the crops are told apart by their item.
					if (crop != null && crop.cropVal.cropId != branchCrop.cropVal.cropId)
						o["branchCrop"] = harvest;
					else
						o["crop"] = harvest;
				}
				IrrigationMonitor.Def irrigation = prefab.GetDef<IrrigationMonitor.Def>();
				if (irrigation?.consumedElements != null)
					o["irrigation"] = new JArray(irrigation.consumedElements.Select(c => new JObject { ["tag"] = c.tag.ToString(), ["rate"] = c.massConsumptionRate }));
				FertilizationMonitor.Def fertilizer = prefab.GetDef<FertilizationMonitor.Def>();
				if (fertilizer?.consumedElements != null)
					o["fertilizer"] = new JArray(fertilizer.consumedElements.Select(c => new JObject { ["tag"] = c.tag.ToString(), ["rate"] = c.massConsumptionRate }));
				PlantFiberProducer fiber = prefab.GetComponent<PlantFiberProducer>();
				if (fiber != null)
					o["skilledHarvestBonus"] = new JObject { ["tag"] = "PlantFiber", ["amount"] = fiber.amount };
				SeedProducer seeds = prefab.GetComponent<SeedProducer>();
				if (seeds != null)
					o["seed"] = new JObject { ["item"] = seeds.seedInfo.seedId, ["productionType"] = seeds.seedInfo.productionType.ToString(), ["count"] = seeds.seedInfo.newSeedsProduced };
				if (prefab.GetDef<PollinationMonitor.Def>() != null)
					o["needsPollination"] = true;
				// A flytrap (the Lura Plant, the Saturn Critter Trap) pauses growing until it has eaten
				// one critter of the kinds it accepts, so each harvest costs one of them.
				// GetPrefabsOfPossiblePrey() also asks whether each prey's DLC is active for the
				// current save, and at the main menu there is none, so the edibility test is run
				// here over every critter instead.
				IPlantConsumeEntities trap = prefab.GetComponent<IPlantConsumeEntities>();
				if (trap != null)
					o["prey"] = new JArray(Assets.GetPrefabsWithComponent<CreatureBrain>().Where(trap.IsEntityEdible).Select(c => c.GetComponent<KPrefabID>().PrefabTag.ToString()));
				// A critter that eats the living plant (a Glo Squid at a Tublia, a Drecko at a Mealwood)
				// takes its growth rather than its harvest; what the plant regrows per cycle is here.
				JArray grazing = Grazing(prefab);
				if (grazing.Count > 0)
					o["grazing"] = grazing;
				arr.Add(o);
			}
			// Vine mothers (the Ovagro Node) have no Growing or Crop of their own: they sprout up to
			// MAX_BRANCH_COUNT vines, and each vine bears the crop. Reported as one plant whose
			// harvest is every vine's, with the node's irrigation.
			foreach (KPrefabID id in Assets.Prefabs)
			{
				VineMother.Def def = id.gameObject.GetDef<VineMother.Def>();
				if (def == null)
					continue;
				GameObject branch = Assets.GetPrefab(def.BRANCH_PREFAB_NAME);
				Crop crop = branch != null ? branch.GetComponent<Crop>() : null;
				if (crop == null)
					continue;
				var o = new JObject
				{
					["id"] = id.PrefabTag.ToString(),
					["name"] = Plain(id.gameObject.GetProperName()),
					["dlc"] = Restrictions(id),
					["branches"] = def.MAX_BRANCH_COUNT,
					["crop"] = new JObject { ["item"] = crop.cropVal.cropId, ["durationSeconds"] = crop.cropVal.cropDuration, ["count"] = crop.cropVal.numProduced * def.MAX_BRANCH_COUNT },
				};
				IrrigationMonitor.Def irrigation = id.gameObject.GetDef<IrrigationMonitor.Def>();
				if (irrigation?.consumedElements != null)
					o["irrigation"] = new JArray(irrigation.consumedElements.Select(c => new JObject { ["tag"] = c.tag.ToString(), ["rate"] = c.massConsumptionRate }));
				PlantFiberProducer fiber = branch.GetComponent<PlantFiberProducer>();
				if (fiber != null)
					o["skilledHarvestBonus"] = new JObject { ["tag"] = "PlantFiber", ["amount"] = fiber.amount * def.MAX_BRANCH_COUNT };
				SeedProducer seeds = branch.GetComponent<SeedProducer>();
				if (seeds != null)
					o["seed"] = new JObject { ["item"] = seeds.seedInfo.seedId, ["productionType"] = seeds.seedInfo.productionType.ToString(), ["count"] = seeds.seedInfo.newSeedsProduced * seeds.seedDropChanceMultiplier * def.MAX_BRANCH_COUNT };
				arr.Add(o);
			}
			return arr;
		}

		/// <summary>
		/// How critters with an EatPlantDirectly or EatPlantStorage diet feed from this plant, from the
		/// game's own consumption instructions. Diets price such food per unit, and a unit is:
		/// growth: one unit of maturity, which a tended plant grows at GROWTH_RATE per second (one a
		/// cycle for every plant in the game) and a wild one at WILD_GROWTH_RATE; a mutant with a
		/// longer growth time holds more maturity per unit, so it yields fewer units a cycle.
		/// branches: the same, summed over every branch the tree can carry at once (an Arbor Tree).
		/// storage: kilograms of the element the plant keeps in itself (a Bonbon Tree's sugar water).
		/// </summary>
		private static JArray Grazing(GameObject prefab)
		{
			var arr = new JArray();
			foreach (IPlantConsumptionInstructions instructions in GameUtil.GetPlantConsumptionInstructions(prefab))
			{
				switch (instructions)
				{
					case DirectlyEdiblePlant_Growth _:
					{
						Growing growing = prefab.GetComponent<Growing>();
						if (growing == null)
							break;
						arr.Add(new JObject
						{
							["kind"] = "growth",
							["unitsPerCycle"] = growing.GROWTH_RATE * 600f,
							["wildUnitsPerCycle"] = growing.WILD_GROWTH_RATE * 600f,
							["minMaturity"] = 0.25f, // CanPlantBeEaten: at least a quarter grown
						});
						break;
					}
					case DirectlyEdiblePlant_TreeBranches branches:
					{
						PlantBranchGrower.Def def = prefab.GetDef<PlantBranchGrower.Def>();
						GameObject branch = def?.BRANCH_PREFAB_NAME != null ? Assets.GetPrefab(def.BRANCH_PREFAB_NAME) : null;
						Growing growing = branch?.GetComponent<Growing>();
						if (def?.BRANCH_OFFSETS == null || growing == null)
							break;
						int count = def.MAX_BRANCH_COUNT >= 0 ? Math.Min(def.MAX_BRANCH_COUNT, def.BRANCH_OFFSETS.Length) : def.BRANCH_OFFSETS.Length;
						arr.Add(new JObject
						{
							["kind"] = "branches",
							["unitsPerCycle"] = growing.GROWTH_RATE * 600f * count,
							["wildUnitsPerCycle"] = growing.WILD_GROWTH_RATE * 600f * count,
							["branches"] = count,
							["minMaturity"] = branches.MinimumEdibleMaturity,
						});
						break;
					}
					case DirectlyEdiblePlant_StorageElement stored:
						arr.Add(new JObject
						{
							["kind"] = "storage",
							["tag"] = stored.tagToConsume.ToString(),
							["unitsPerCycle"] = stored.MassGeneratedPerCycle,
							["minMaturity"] = stored.minimum_mass_percentageRequiredToEat,
						});
						break;
				}
			}
			return arr;
		}

		private static JArray Geysers()
		{
			var arr = new JArray();
			var types = AccessTools.Field(typeof(GeyserConfigurator), "geyserTypes")?.GetValue(null) as List<GeyserConfigurator.GeyserType>;
			if (types == null)
				return arr;
			foreach (var g in types)
			{
				arr.Add(new JObject
				{
					["id"] = g.id,
					["element"] = g.element.ToString(),
					["dlc"] = Restrictions(g),
					["temperature"] = g.temperature,
					["minRatePerCycle"] = g.minRatePerCycle,
					["maxRatePerCycle"] = g.maxRatePerCycle,
				});
			}
			return arr;
		}

		/// <summary>
		/// A world's template spawn rules that place geysers, vents, volcanoes, or terrain
		/// features buildings sit on (Oil Reservoirs), with the prefabs each named template
		/// contains, so the app knows which a world is guaranteed (GuaranteeX rules) or may get
		/// (TryX rules), and how many. The generic random geysers ("geysers/generic") are
		/// reported as such; their types are decided by the seed. A subworld's own template
		/// rules count too, and a subworld feature that spawns such an entity (the oil patch
		/// feature holding one Oil Reservoir) is reported as a rule guaranteeing one.
		/// </summary>
		private static JArray GeyserRules(ProcGen.World world)
		{
			var arr = new JArray();
			foreach (var rule in world.worldTemplateRules ?? new List<ProcGen.World.TemplateSpawnRules>())
				AddRule(arr, rule);
			foreach (var subworldFile in world.subworldFiles ?? new List<ProcGen.WeightedSubworldName>())
			{
				if (!ProcGen.SettingsCache.subworlds.TryGetValue(subworldFile.name, out ProcGen.SubWorld subworld))
					continue;
				foreach (var rule in subworld.subworldTemplateRules ?? new List<ProcGen.World.TemplateSpawnRules>())
					AddRule(arr, rule);
				var features = new List<ProcGen.Feature>(subworld.features ?? new List<ProcGen.Feature>());
				if (subworld.centralFeature != null)
					features.Add(subworld.centralFeature);
				foreach (var feature in features)
				{
					if (feature?.type == null)
						continue;
					ProcGen.FeatureSettings settings = null;
					try { settings = ProcGen.SettingsCache.GetCachedFeature(feature.type); } catch { }
					var placed = new JArray();
					foreach (var mob in settings?.internalMobs ?? new List<ProcGen.MobReference>())
						if (mob.type != null && IsFeature(mob.type))
							placed.Add(mob.type);
					if (placed.Count == 0)
						continue;
					arr.Add(new JObject
					{
						["ruleId"] = "feature:" + feature.type,
						["listRule"] = "GuaranteeOne",
						["someCount"] = 0,
						["moreCount"] = 0,
						["rangeMin"] = 0,
						["rangeMax"] = 0,
						["times"] = 1,
						["templates"] = new JArray(new JObject { ["template"] = feature.type, ["geysers"] = placed }),
					});
				}
			}
			return arr;
		}

		private static void AddRule(JArray arr, ProcGen.World.TemplateSpawnRules rule)
		{
			var templates = new JArray();
			foreach (string name in rule.names ?? new List<string>())
			{
				var geysers = new JArray();
				if (name == "geysers/generic")
					geysers.Add("GeyserGeneric");
				else
				{
					TemplateContainer template = null;
					try { template = TemplateCache.GetTemplate(name); } catch { }
					if (template != null)
					{
						foreach (var prefab in (template.otherEntities ?? new List<TemplateClasses.Prefab>()).Concat(template.buildings ?? new List<TemplateClasses.Prefab>()))
							if (prefab.id != null && (prefab.id.StartsWith("GeyserGeneric") || prefab.id.Contains("Geyser") || prefab.id.Contains("Volcano") || prefab.id.Contains("Vent") || IsFeature(prefab.id)))
								geysers.Add(prefab.id);
					}
				}
				if (geysers.Count > 0)
					templates.Add(new JObject { ["template"] = name, ["geysers"] = geysers });
			}
			if (templates.Count == 0)
				return;
			arr.Add(new JObject
			{
				["ruleId"] = rule.ruleId ?? "",
				["listRule"] = rule.listRule.ToString(),
				["someCount"] = rule.someCount,
				["moreCount"] = rule.moreCount,
				["rangeMin"] = rule.range.x,
				["rangeMax"] = rule.range.y,
				["times"] = rule.times,
				["templates"] = templates,
			});
		}

		/// <summary>Clusters (the "which asteroid" choice): their worlds, which one you start on, and their space POIs.</summary>
		private static JArray Clusters()
		{
			var arr = new JArray();
			foreach (var kv in ProcGen.SettingsCache.clusterLayouts.clusterCache)
			{
				var c = kv.Value;
				arr.Add(new JObject
				{
					["id"] = kv.Key,
					["name"] = Plain(Strings.Get(c.name)),
					["dlc"] = Restrictions(c),
					["startWorldIndex"] = c.startWorldIndex,
					["worlds"] = new JArray((c.worldPlacements ?? new List<ProcGen.WorldPlacement>()).Select(w => w.world)),
					["spacePois"] = new JArray((c.poiPlacements ?? new List<ProcGen.SpaceMapPOIPlacement>()).Select(p => new JObject
					{
						["pois"] = new JArray(p.pois ?? new List<string>()),
						["numToSpawn"] = p.numToSpawn,
						["guarantee"] = p.guarantee,
					})),
				});
			}
			return arr;
		}

		/// <summary>
		/// Base-game rocket destinations (the Starmap without Spaced Out): each type's element
		/// table (weight ranges the cargo is split by), recoverable entities, and recharge.
		/// Spaced Out replaces these with clusters and harvestable POIs.
		/// </summary>
		private static JArray SpaceDestinations()
		{
			var arr = new JArray();
			var types = Db.Get().SpaceDestinationTypes;
			if (types == null)
				return arr;
			for (int i = 0; i < types.Count; i++)
			{
				var t = types[i];
				arr.Add(new JObject
				{
					["id"] = t.Id,
					["name"] = Plain(t.typeName),
					["visitable"] = t.visitable,
					["cyclesToRecover"] = t.cyclesToRecover,
					["massToRecover"] = Database.SpaceDestinationType.MASS_TO_RECOVER,
					["minMass"] = t.minimumMass,
					["maxMass"] = t.maxiumMass,
					["elements"] = new JObject((t.elementTable ?? new Dictionary<SimHashes, MathUtil.MinMax>()).Select(e => new JProperty(e.Key.ToString(), new JObject { ["min"] = e.Value.min, ["max"] = e.Value.max }))),
					["entities"] = new JObject((t.recoverableEntities ?? new Dictionary<string, int>()).Select(e => new JProperty(e.Key, e.Value))),
				});
			}
			return arr;
		}

		/// <summary>Harvestable space POIs (asteroid fields): what rocket missions can mine from them.</summary>
		private static JArray SpacePois()
		{
			var arr = new JArray();
			var types = AccessTools.Field(typeof(HarvestablePOIConfigurator), "_poiTypes")?.GetValue(null) as List<HarvestablePOIConfigurator.HarvestablePOIType>;
			foreach (var p in types ?? new List<HarvestablePOIConfigurator.HarvestablePOIType>())
			{
				arr.Add(new JObject
				{
					["id"] = p.id,
					["dlc"] = Restrictions(p),
					["elements"] = new JObject(p.harvestableElements.Select(e => new JProperty(e.Key.ToString(), e.Value))),
					["capacityMin"] = p.poiCapacityMin,
					["capacityMax"] = p.poiCapacityMax,
					["rechargeMin"] = p.poiRechargeMin,
					["rechargeMax"] = p.poiRechargeMax,
				});
			}
			return arr;
		}

		/// <summary>
		/// Which worlds (asteroids) place each element in their terrain, via the worldgen cache:
		/// world -> subworld files -> biomes -> element bands. Worlds carry the DLC they belong
		/// to. Templates (POIs) and geysers are not included here.
		/// </summary>
		private static JArray Worldgen()
		{
			var arr = new JArray();
			// Only worldgen itself sets the template cache up, so at the main menu it may not
			// exist yet; without it every template lookup fails and the rules come back empty.
			if (!TemplateCache.Initted)
				TemplateCache.Init();
			var bands = ProcGen.SettingsCache.biomes?.BiomeBackgroundElementBandConfigurations;
			if (bands == null)
				return arr;
			foreach (var world in ProcGen.SettingsCache.worlds.worldCache)
			{
				var elements = new HashSet<string>();
				var biomes = new HashSet<string>();
				foreach (var subworldFile in world.Value.subworldFiles ?? new List<ProcGen.WeightedSubworldName>())
				{
					if (!ProcGen.SettingsCache.subworlds.TryGetValue(subworldFile.name, out ProcGen.SubWorld subworld) || subworld.biomes == null)
						continue;
					foreach (var biome in subworld.biomes)
					{
						biomes.Add(biome.name);
						if (bands.TryGetValue(biome.name, out ElementBandConfiguration band))
							foreach (ElementGradient gradient in band)
								elements.Add(gradient.content);
					}
				}
				arr.Add(new JObject
				{
					["world"] = world.Key,
					["name"] = Plain(Strings.Get(world.Value.name)),
					["dlc"] = Restrictions(world.Value),
					["biomes"] = new JArray(biomes.OrderBy(b => b)),
					["elements"] = new JArray(elements.OrderBy(e => e)),
					["geyserRules"] = GeyserRules(world.Value),
				});
			}
			return arr;
		}
	}
}
