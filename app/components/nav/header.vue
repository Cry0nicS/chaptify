<script setup lang="ts">
import {useNavItems} from "~/composables/use-nav-items";

/**
 * Plain sticky header: a full-width bar with a hairline rule, hand-built so the current-page lap bar
 * can sit under the link — but every control inside it is a Nuxt UI component.
 *
 * Below `sm` the links do not fit the bar, so they move into a slide-over sheet (focus trap, escape
 * and scroll locking come from `USlideover`). The sheet closes when a link is selected — including
 * the link for the page already open, which produces no route change — and the route watcher covers
 * navigation that happens without a tap, such as browser back while the sheet is open.
 */
const {navigationItems, legalItems} = useNavItems();
const route = useRoute();

const isMenuOpen = ref(false);

// The sheet lists the legal link too; the desktop bar deliberately does not.
const menuItems = computed(() => [...navigationItems.value, ...legalItems.value]);

const isCurrent = (to?: string) => route.path === to;

const openMenu = () => {
    isMenuOpen.value = true;
};

const closeMenu = () => {
    isMenuOpen.value = false;
};

watch(() => route.fullPath, closeMenu);
</script>

<template>
    <header class="border-default bg-default/95 sticky top-0 z-30 border-b">
        <div
            class="mx-auto flex h-16 max-w-(--ui-container) items-center gap-2 px-4 sm:px-6 lg:px-8">
            <NuxtLink
                class="text-highlighted font-display mr-auto inline-flex items-center gap-2.5 text-2xl font-bold tracking-tight"
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
            :ui="{content: 'divide-y-0'}">
            <template #body>
                <nav
                    class="flex flex-col gap-1"
                    aria-label="Main">
                    <NuxtLink
                        v-for="item in menuItems"
                        :key="item.to as string"
                        class="hover:bg-muted flex items-center gap-3 rounded-md px-3 py-3 text-lg font-semibold transition-colors"
                        :class="
                            isCurrent(item.to as string)
                                ? 'text-primary bg-primary/10'
                                : 'text-toned'
                        "
                        :to="item.to as string"
                        :aria-current="isCurrent(item.to as string) ? 'page' : undefined"
                        @click="closeMenu">
                        <UIcon
                            :name="item.icon as string"
                            class="size-5 shrink-0" />
                        {{ item.label }}
                    </NuxtLink>
                </nav>
            </template>
        </USlideover>
    </header>
</template>
