<script setup lang="ts">
import {useNavItems} from "~/composables/use-nav-items";

const {navigationItems} = useNavItems();
</script>

<template>
    <UHeader
        class="h-17.5"
        mode="modal"
        title="Chaptify"
        to="/"
        :menu="{transition: true}"
        :ui="{
            body: 'flex justify-center text-2xl'
        }">
        <template #title>
            <span class="flex items-center gap-2.5">
                <AppLogo class="h-9 w-auto" />
                <span class="font-display text-highlighted text-xl font-bold tracking-tight">
                    Chaptify
                </span>
            </span>
        </template>

        <UNavigationMenu
            color="primary"
            :highlight="true"
            highlight-color="primary"
            :items="navigationItems" />

        <template #right>
            <NavThemeToggle />
        </template>

        <template #body>
            <UNavigationMenu
                color="primary"
                :highlight="true"
                highlight-color="primary"
                :items="navigationItems"
                orientation="vertical"
                :ui="{
                    list: 'flex flex-col gap-4',
                    linkLabel: 'text-2xl',
                    linkLeadingIcon: 'size-6'
                }" />
        </template>
    </UHeader>
</template>
