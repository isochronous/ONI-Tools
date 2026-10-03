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
				["dlcs"] = new JArray(DlcIds().Select(id => new JObject { ["id"] = id, ["name"] = DlcName(id) })),
				["elements"] = Elements(),
				["items"] = Items(),
				["recipes"] = Recipes(),
				["buildings"] = Buildings(),
				["critters"] = Critters(),
				["plants"] = Plants(),
				["geysers"] = Geysers(),
				["worldgen"] = Worldgen(),
			};
			File.WriteAllText(path, root.ToString(Formatting.Indented));
		}

		// ---- helpers ----

		private static IEnumerable<string> DlcIds()
		{
			return new[] { DlcManager.EXPANSION1_ID, DlcManager.DLC2_ID, DlcManager.DLC3_ID, DlcManager.DLC4_ID, DlcManager.DLC5_ID };
		}

		private static string DlcName(string id)
		{
			try { return DlcManager.GetDlcTitle(id); }
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

		private static string Name(Tag tag)
		{
			string name = tag.ProperName();
			return string.IsNullOrEmpty(name) ? tag.ToString() : name;
		}

		private static JObject Amount(Tag tag, float amount)
		{
			return new JObject { ["tag"] = tag.ToString(), ["amount"] = amount };
		}

		// ---- sections ----

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
					["name"] = e.name,
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

		/// <summary>Non-element things that recipes, diets, and drops refer to: food, seeds, eggs, shells, critters.</summary>
		private static JArray Items()
		{
			var arr = new JArray();
			foreach (KPrefabID id in Assets.Prefabs)
			{
				GameObject prefab = id.gameObject;
				if (prefab.GetComponent<BuildingComplete>() != null || prefab.GetComponent<PrimaryElement>() == null)
					continue;
				if (ElementLoader.GetElement(id.PrefabTag) != null)
					continue;
				var o = new JObject
				{
					["id"] = id.PrefabTag.ToString(),
					["name"] = prefab.GetProperName(),
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
				FlushToilet flush = go.GetComponent<FlushToilet>();
				if (flush != null)
				{
					inputs.Add(new JObject { ["tag"] = "Water", ["amountPerUse"] = flush.massConsumedPerUse, ["via"] = "FlushToilet" });
					outputs.Add(new JObject { ["tag"] = "DirtyWater", ["amountPerUse"] = flush.massEmittedPerUse, ["via"] = "FlushToilet" });
				}
				if (inputs.Count == 0 && outputs.Count == 0)
					continue;
				arr.Add(new JObject
				{
					["id"] = def.PrefabID,
					["name"] = def.Name,
					["dlc"] = new JObject { ["requires"] = new JArray(def.RequiredDlcIds ?? new string[0]), ["forbids"] = new JArray(def.ForbiddenDlcIds ?? new string[0]) },
					["inputs"] = inputs,
					["outputs"] = outputs,
				});
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
					["name"] = prefab.GetProperName(),
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
				Butcherable butcherable = prefab.GetComponent<Butcherable>();
				if (butcherable?.drops != null)
					o["deathDrops"] = new JArray(butcherable.drops.Select(d => new JObject { ["tag"] = d.Key, ["count"] = d.Value }));
				FertilityMonitor.Def fertility = prefab.GetDef<FertilityMonitor.Def>();
				if (fertility != null)
					o["egg"] = fertility.eggPrefab.ToString();
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
					["name"] = prefab.GetProperName(),
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
				SeedProducer seeds = prefab.GetComponent<SeedProducer>();
				if (seeds != null)
					o["seed"] = new JObject { ["item"] = seeds.seedInfo.seedId, ["productionType"] = seeds.seedInfo.productionType.ToString(), ["count"] = seeds.seedInfo.newSeedsProduced };
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
					["name"] = world.Value.name,
					["dlc"] = Restrictions(world.Value),
					["biomes"] = new JArray(biomes.OrderBy(b => b)),
					["elements"] = new JArray(elements.OrderBy(e => e)),
				});
			}
			return arr;
		}
	}
}
