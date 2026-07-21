<script setup lang="ts">
// Informational, dismissible notice — NOT a consent request. Chaptify uses only strictly-necessary
// browser storage (no cookies, no tracking), which is consent-exempt, so this only informs. The
// dismissed flag is itself functional storage (a remembered UI choice) kept in localStorage, in
// keeping with the "no cookies" statement. `visible` starts false so the SSR and first client
// render match; onMounted then decides whether to reveal it (and the enter transition plays).
const DISMISS_KEY = "chaptify.privacyNoticeDismissed";
const visible = ref(false);

const hasDismissed = () => {
    try {
        return localStorage.getItem(DISMISS_KEY) === "true";
    } catch {
        return false;
    }
};

const dismiss = () => {
    visible.value = false;

    try {
        localStorage.setItem(DISMISS_KEY, "true");
    } catch {
        // Storage unavailable (e.g. private mode): dismissing for this view is enough.
    }
};

onMounted(() => {
    visible.value = !hasDismissed();
});
</script>

<template>
    <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="translate-y-4 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="translate-y-4 opacity-0">
        <div
            v-if="visible"
            class="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl sm:right-6 sm:left-auto sm:mx-0 sm:max-w-lg"
            role="region"
            aria-label="Privacy notice">
            <UCard
                variant="subtle"
                :ui="{
                    root: 'border-default shadow-xl shadow-black/10 backdrop-blur',
                    body: 'p-4 sm:p-5'
                }">
                <div class="flex gap-4">
                    <UIcon
                        name="i-lucide-shield-check"
                        class="text-primary mt-1 size-5 shrink-0" />

                    <div class="min-w-0 flex-1 space-y-3">
                        <div class="space-y-1">
                            <h2 class="text-highlighted text-base font-semibold">
                                Privacy, kept simple
                            </h2>
                            <p class="text-muted text-sm leading-6">
                                Chaptify uses only essential browser storage to run — no cookies, no
                                ads, and we never sell your data.
                            </p>
                        </div>

                        <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
                            <UButton
                                to="/privacy"
                                color="neutral"
                                variant="outline"
                                icon="i-lucide-shield-user">
                                How we handle data
                            </UButton>
                            <UButton
                                icon="i-lucide-check"
                                aria-label="Dismiss privacy notice"
                                @click="dismiss">
                                Got it
                            </UButton>
                        </div>
                    </div>
                </div>
            </UCard>
        </div>
    </Transition>
</template>
