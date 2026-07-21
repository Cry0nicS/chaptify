<script setup lang="ts">
// Informational, dismissible notice — NOT a consent request. Chaptify uses only strictly-necessary
// browser storage (no cookies, no tracking), which is consent-exempt, so this only informs. The
// dismissed flag is itself functional storage (remembering a UI choice) kept in localStorage, in
// keeping with the "no cookies" statement. Rendered client-only because visibility depends on
// localStorage, which does not exist during SSR.
const DISMISS_KEY = "chaptify.privacyNoticeDismissed";
const visible = ref(false);

onMounted(() => {
    try {
        visible.value = window.localStorage.getItem(DISMISS_KEY) !== "1";
    } catch {
        // Storage unavailable (e.g. private mode): show the notice for this view.
        visible.value = true;
    }
});

const dismiss = () => {
    visible.value = false;

    try {
        window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
        // Storage unavailable: dismissing for this view is enough.
    }
};
</script>

<template>
    <ClientOnly>
        <Transition
            enter-active-class="transition duration-300 ease-out"
            enter-from-class="translate-y-4 opacity-0"
            enter-to-class="translate-y-0 opacity-100"
            leave-active-class="transition duration-200 ease-in"
            leave-from-class="translate-y-0 opacity-100"
            leave-to-class="translate-y-4 opacity-0">
            <div
                v-if="visible"
                class="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-4"
                role="region"
                aria-label="Privacy notice">
                <div
                    class="border-default bg-default/95 flex max-w-2xl items-center gap-3 rounded-lg border p-3 shadow-lg backdrop-blur sm:gap-4 sm:p-4">
                    <p class="text-muted grow text-sm">
                        Chaptify uses only essential browser storage to run — no cookies, no ads,
                        and we never sell your data.
                        <ULink
                            to="/privacy"
                            class="text-primary font-medium">
                            How we handle data
                        </ULink>
                    </p>
                    <UButton
                        color="neutral"
                        variant="soft"
                        size="sm"
                        aria-label="Dismiss privacy notice"
                        @click="dismiss">
                        Got it
                    </UButton>
                </div>
            </div>
        </Transition>
    </ClientOnly>
</template>
