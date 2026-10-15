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
				// Global starts WorldGen.LoadSettings on a worker thread at boot; it logs "World settings
				// reload complete!" and then keeps going, preloading templates into TemplateCache. Reading
				// SettingsCache and TemplateCache while that runs throws "Collection was modified", and an
				// error log with a stack trace makes the game blame this mod and offer a restart. Join it.
				ProcGenGame.WorldGen.WaitForPendingLoadSettings();
				Dump.WriteTo(path);
				Debug.Log("[OniDataDump] Wrote " + path);
				// Icons do not depend on the DLC set beyond which things exist, so one folder serves every flavour.
				string icons = Path.Combine(Util.RootFolder(), "oni-data-dump.icons");
				Dump.WriteIcons(icons);
				Debug.Log("[OniDataDump] Wrote icons to " + icons);
			}
			catch (Exception e)
			{
				// A warning without the stack trace: the game only blames mods for errors that carry one.
				Debug.LogWarning("[OniDataDump] Dump failed: " + e.GetType().Name + ": " + e.Message);
				Debug.Log("[OniDataDump] Dump failure detail: " + e);
			}
		}
	}
}
