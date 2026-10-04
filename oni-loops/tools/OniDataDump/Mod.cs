using System;
using System.IO;
using HarmonyLib;
using KMod;
using UnityEngine;

namespace OniDataDump
{
	public sealed class OniDataDumpMod : UserMod2
	{
		public override void OnLoad(Harmony harmony)
		{
			base.OnLoad(harmony);
			Debug.Log("[OniDataDump] Loaded version " + typeof(OniDataDumpMod).Assembly.GetName().Version);
		}
	}

	/// <summary>
	/// Everything the dump needs exists once the main menu is up: elements, building defs
	/// and their prefabs, critter and plant prefabs, recipes, geyser types, and the worldgen
	/// settings cache. Runs once per game launch.
	/// </summary>
	[HarmonyPatch(typeof(MainMenu), "OnSpawn")]
	internal static class MainMenu_OnSpawn_Patch
	{
		private static bool done;

		private static void Postfix()
		{
			if (done)
				return;
			done = true;
			// One file per DLC set, so a Spaced Out run and a base-game run do not overwrite
			// each other: oni-data-dump.all-dlcs.json, oni-data-dump.no-spaced-out.json, ...
			string path = Path.Combine(Util.RootFolder(), "oni-data-dump." + Dump.Flavour() + ".json");
			try
			{
				Dump.WriteTo(path);
				Debug.Log("[OniDataDump] Wrote " + path);
				// Icons do not depend on the DLC set beyond which things exist, so one folder serves every flavour.
				string icons = Path.Combine(Util.RootFolder(), "oni-data-dump.icons");
				Dump.WriteIcons(icons);
				Debug.Log("[OniDataDump] Wrote icons to " + icons);
			}
			catch (Exception e)
			{
				Debug.LogError("[OniDataDump] Dump failed: " + e);
			}
		}
	}
}
