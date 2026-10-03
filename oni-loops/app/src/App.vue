<script setup lang="ts">
import { RouterView } from 'vue-router'
import { gameData } from './data/load'
</script>

<template>
  <header class="top">
    <h1><RouterLink to="/">ONI Loops</RouterLink></h1>
    <span class="sub">How can I get more of this? · game data {{ gameData.game.build.split('-').slice(0, 2).join('-') }}</span>
  </header>
  <RouterView />
  <footer class="bottom">
    Data read from the running game by <a href="https://github.com/isochronous/oni-loops">oni-loops</a>' dump tool. Not affiliated with Klei.
  </footer>
</template>

<style scoped>
.top {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 1.25rem;
}
h1 {
  font-size: 1.4rem;
  margin: 0;
}
h1 a {
  color: var(--text);
  text-decoration: none;
}
.sub {
  color: var(--muted);
  font-size: 0.85rem;
}
.bottom {
  margin-top: 2.5rem;
  color: var(--muted);
  font-size: 0.8rem;
}
</style>
