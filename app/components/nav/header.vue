<script setup lang="ts">
import {useNavItems} from "~/composables/use-nav-items";

/**
 * Floating pill header. The bar is an ornament over the aurora field rather than a full-width band,
 * so it is hand-built from the pane material — but every control inside it is a Nuxt UI component.
 *
 * Below `sm` the links do not fit the pill, so they move into a slide-over sheet (focus trap, escape
 * and scroll locking come from `USlideover`) which closes itself on navigation.
 */
const {navigationItems} = useNavItems();
const route = useRoute();

const isMenuOpen = ref(false);

const isCurrent = (to?: string) => route.path === to;

const openMenu = () => {
    isMenuOpen.value = true;
};

watch(
    () => route.fullPath,
    () => {
        isMenuOpen.value = false;
    }
);
</script>

<template>
    <header class="sticky top-0 z-30 flex justify-center px-4 pt-4 sm:px-6">
        <div class="pane pane-pill flex w-full max-w-3xl items-center gap-2 py-2 pr-2 pl-4">
            <NuxtLink
                class="text-highlighted mr-auto inline-flex items-center gap-2.5 text-base font-bold tracking-tight"
                to="/"
                :aria-current="isCurrent('/') ? 'page' : undefined">
                <AppLogo class="h-7 w-auto" />
                <span>Chaptify</span>
            </NuxtLink>

            <nav
                class="hidden items-center gap-1 sm:flex"
                aria-label="Main">
                <NuxtLink
                    v-for="item in navigationItems"
                    :key="item.to as string"
                    class="nav-link"
                    :class="isCurrent(item.to as string) ? 'nav-link-active' : ''"
                    :to="item.to as string"
                    :aria-current="isCurrent(item.to as string) ? 'page' : undefined">
                    {{ item.label }}
                </NuxtLink>
            </nav>

            <NavThemeToggle />

            <UButton
                class="sm:hidden"
                color="neutral"
                variant="ghost"
                size="xl"
                icon="i-lucide-menu"
                aria-label="Open menu"
                @click="openMenu" />
        </div>

        <USlideover
            v-model:open="isMenuOpen"
            title="Chaptify"
            description="Site navigation"
            :ui="{content: 'divide-y-0 bg-default/85 backdrop-blur-xl'}">
            <template #body>
                <nav
                    class="flex flex-col gap-1"
                    aria-label="Main">
                    <NuxtLink
                        v-for="item in navigationItems"
                        :key="item.to as string"
                        class="hover:bg-elevated flex items-center gap-3 rounded-xl px-3 py-3 text-lg font-medium transition-colors"
                        :class="
                            isCurrent(item.to as string)
                                ? 'text-primary bg-primary/8'
                                : 'text-toned'
                        "
                        :to="item.to as string"
                        :aria-current="isCurrent(item.to as string) ? 'page' : undefined">
                        <UIcon
                            :name="item.icon as string"
                            class="size-5 shrink-0" />
                        {{ item.label }}
                    </NuxtLink>

                    <NuxtLink
                        class="text-toned hover:bg-elevated mt-2 flex items-center gap-3 rounded-xl px-3 py-3 text-lg font-medium transition-colors"
                        to="/privacy">
                        <UIcon
                            name="i-lucide-shield-user"
                            class="size-5 shrink-0" />
                        Privacy
                    </NuxtLink>
                </nav>
            </template>
        </USlideover>
    </header>
</template>
