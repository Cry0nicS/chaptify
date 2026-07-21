<script setup lang="ts">
const {navigationItems} = useNavItems();
</script>

<template>
    <div class="flex min-h-svh flex-col">
        <NavHeader />

        <UMain class="grow">
            <UContainer>
                <slot />
            </UContainer>
        </UMain>

        <NavFooter>
            <template #links>
                <UNavigationMenu
                    class="hidden md:flex"
                    :highlight="true"
                    :items="navigationItems" />
                <ULink
                    to="/privacy"
                    class="text-muted hover:text-highlighted text-sm">
                    Privacy
                </ULink>
            </template>
            <template #social>
                <NavThemeToggle />
            </template>
        </NavFooter>

        <PrivacyNotice />
    </div>
</template>
