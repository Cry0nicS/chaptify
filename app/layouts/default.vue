<script setup lang="ts">
const {navigationItems, legalItems} = useNavItems();

// The footer carries the legal link alongside the main ones.
const footerItems = computed(() => [...navigationItems.value, ...legalItems.value]);
const route = useRoute();

const isCurrent = (to?: string) => route.path === to;
</script>

<template>
    <div class="flex min-h-svh flex-col">
        <!-- The lit field: one fixed decorative layer the whole site floats on. -->
        <div
            class="aurora-field"
            aria-hidden="true">
            <span class="aurora-blob aurora-blob-blue" />
            <span class="aurora-blob aurora-blob-violet" />
            <span class="aurora-blob aurora-blob-mint" />
        </div>

        <NavHeader />

        <UMain class="relative z-1 grow">
            <UContainer>
                <slot />
            </UContainer>
        </UMain>

        <NavFooter>
            <template #links>
                <NuxtLink
                    v-for="item in footerItems"
                    :key="item.to as string"
                    class="nav-link"
                    :to="item.to as string"
                    :aria-current="isCurrent(item.to as string) ? 'page' : undefined">
                    {{ item.label }}
                </NuxtLink>
            </template>
            <template #social>
                <NavThemeToggle />
            </template>
        </NavFooter>

        <PrivacyNotice />
    </div>
</template>
