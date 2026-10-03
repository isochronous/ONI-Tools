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
			string path = Path.Combine(Util.RootFolder(), "oni-data-dump.json");
			try
			{
				Dump.WriteTo(path);
				Debug.Log("[OniDataDump] Wrote " + path);
			}
			catch (Exception e)
			{
				Debug.LogError("[OniDataDump] Dump failed: " + e);
			}
		}
	}
}
