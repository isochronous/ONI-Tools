<script setup lang="ts">
import { RouterView } from 'vue-router'
import { dataSet, gameData } from './data/load'

const build = gameData.game.build.split('-').slice(0, 2).join('-')
</script>

<template>
  <header class="top">
    <h1><RouterLink to="/">ONI Loops</RouterLink></h1>
    <p class="sub">Game data {{ build }}, {{ dataSet.name }}</p>
  </header>
  <RouterView />
  <footer class="bottom">
    <p>
      Read from the running game by the
      <a href="https://github.com/isochronous/oni-loops">oni-loops</a> dump tool. Not affiliated
      with Klei.
    </p>
  </footer>
</template>

<style scoped>
.top {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1.5rem;
}
h1 {
  margin: 0;
  font-size: 1.25rem;
}
h1 a {
  color: var(--text);
  text-decoration: none;
}
.sub {
  color: var(--muted);
  font-size: 0.875rem;
}
.bottom {
  margin-top: 3rem;
  color: var(--faint);
  font-size: 0.8125rem;
}
</style>
