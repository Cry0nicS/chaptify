<script setup lang="ts">
const {navigationItems} = useNavItems();
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
                    v-for="item in navigationItems"
                    :key="item.to as string"
                    class="nav-link"
                    :to="item.to as string"
                    :aria-current="isCurrent(item.to as string) ? 'page' : undefined">
                    {{ item.label }}
                </NuxtLink>
                <NuxtLink
                    class="nav-link"
                    to="/privacy"
                    :aria-current="isCurrent('/privacy') ? 'page' : undefined">
                    Privacy
                </NuxtLink>
            </template>
            <template #social>
                <NavThemeToggle />
            </template>
        </NavFooter>

        <PrivacyNotice />
    </div>
</template>
