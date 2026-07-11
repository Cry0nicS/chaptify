<script setup lang="ts">
const { navigationItems } = useNavItems()
</script>

<template>
  <div class="flex min-h-svh flex-col">
    <NavHeader />

    <UMain class="grow">
      <UContainer>
        <slot />
      </UContainer>
    </UMain>

    <ClientOnly>
      <USeparator
        :avatar="{
          src: '/favicon.ico',
          loading: 'lazy'
        }" />
    </ClientOnly>

    <NavFooter>
      <template #links>
        <UNavigationMenu
          class="hidden md:flex"
          :highlight="true"
          :items="navigationItems" />
      </template>
      <template #social>
        <NavThemeToggle />
      </template>
    </NavFooter>
  </div>
</template>
