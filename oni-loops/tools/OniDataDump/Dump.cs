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
					// The sim only changes phase this many kelvin past lowTemp / highTemp.
					["stateTransitionBufferK"] = SimMessages.STATE_TRANSITION_TEMPERATURE_BUFER,
					// A Mimika's pollination: growth bonus, how long it lasts, and the pause between plants.
					["pollination"] = new JObject
					{
						["growthBonus"] = ButterflyTuning.CROP_TENDED_MULTIPLIER_EFFECT,
						["effectSeconds"] = ButterflyTuning.CROP_TENDED_MULTIPLIER_DURATION,
						["searchCooldownSeconds"] = ButterflyTuning.SEARCH_COOLDOWN,
					},
				},
				["dlcs"] = new JArray(DlcIds().Select(id => new JObject { ["id"] = id, ["name"] = DlcName(id) })),
				["names"] = Names(),
				["elements"] = Elements(),
				["items"] = Items(),
				["recipes"] = Recipes(),
				["buildings"] = Buildings(),
				["critters"] = Critters(),
				["plants"] = Plants(),
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
				foreach (ElementConverter c in go.GetComponents<ElementConverter>())
				{
					foreach (var ce in c.consumedElements ?? new ElementConverter.ConsumedElement[0])
						inputs.Add(new JObject { ["tag"] = ce.Tag.ToString(), ["rate"] = ce.MassConsumptionRate, ["via"] = "ElementConverter" });
					foreach (var oe in c.outputElements ?? new ElementConverter.OutputElement[0])
						outputs.Add(new JObject { ["tag"] = oe.elementHash.ToString(), ["rate"] = oe.massGenerationRate, ["via"] = "ElementConverter" });
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
					o["shear"] = new JObject { ["item"] = scales.itemDroppedOnShear.ToString(), ["atmosphere"] = scales.targetAtmosphere.ToString() };
				arr.Add(o);
			}
			return arr;
		}

		private static JArray Plants()
		{
			var arr = new JArray();
			foreach (GameObject prefab in Assets.GetPrefabsWithComponent<Growing>())
			{
				KPrefabID id = prefab.GetComponent<KPrefabID>();
				var o = new JObject
				{
					["id"] = id.PrefabTag.ToString(),
					["name"] = Plain(prefab.GetProperName()),
					["dlc"] = Restrictions(id),
				};
				Crop crop = prefab.GetComponent<Crop>();
				if (crop != null)
					o["crop"] = new JObject { ["item"] = crop.cropVal.cropId, ["durationSeconds"] = crop.cropVal.cropDuration, ["count"] = crop.cropVal.numProduced };
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
		/// A world's template spawn rules that place geysers, vents, or volcanoes, with the
		/// geyser prefabs each named template contains, so the app knows which geyser types a
		/// world is guaranteed (GuaranteeX rules) or may get (TryX rules), and how many. The
		/// generic random geysers ("geysers/generic") are reported as such; their types are
		/// decided by the seed.
		/// </summary>
		private static JArray GeyserRules(ProcGen.World world)
		{
			var arr = new JArray();
			foreach (var rule in world.worldTemplateRules ?? new List<ProcGen.World.TemplateSpawnRules>())
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
								if (prefab.id != null && (prefab.id.StartsWith("GeyserGeneric") || prefab.id.Contains("Geyser") || prefab.id.Contains("Volcano") || prefab.id.Contains("Vent")))
									geysers.Add(prefab.id);
						}
					}
					if (geysers.Count > 0)
						templates.Add(new JObject { ["template"] = name, ["geysers"] = geysers });
				}
				if (templates.Count == 0)
					continue;
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
			return arr;
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
