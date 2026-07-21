<script setup lang="ts">
import type {NavigationMenuItem} from "@nuxt/ui";

const {navigationItems} = useNavItems();

// Footer-only legal link. Rendered through UNavigationMenu (not in the shared nav items, so it
// stays out of the header) so it matches the other footer links' styling and carries an icon.
const footerItems: NavigationMenuItem[] = [
    {label: "Privacy", to: "/privacy", icon: "i-lucide-shield-user"}
];
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
                <UNavigationMenu
                    :highlight="true"
                    :items="footerItems" />
            </template>
            <template #social>
                <NavThemeToggle />
            </template>
        </NavFooter>

        <PrivacyNotice />
    </div>
</template>
