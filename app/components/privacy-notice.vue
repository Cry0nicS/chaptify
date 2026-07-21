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
        enter-from-class="translate-y-3 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="translate-y-3 opacity-0">
        <div
            v-if="visible"
            class="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md sm:right-6 sm:bottom-6 sm:left-auto sm:mx-0 sm:max-w-sm"
            role="region"
            aria-label="Privacy notice">
            <UCard
                variant="subtle"
                :ui="{
                    root: 'border-default shadow-lg shadow-black/5 backdrop-blur',
                    body: 'p-4'
                }">
                <div class="space-y-3">
                    <div class="flex items-start gap-2.5">
                        <UIcon
                            name="i-lucide-shield-check"
                            class="text-primary mt-0.5 size-4 shrink-0" />
                        <div class="space-y-1">
                            <p class="text-highlighted text-sm font-semibold">
                                Privacy, kept simple
                            </p>
                            <p class="text-muted text-xs leading-relaxed">
                                Only essential browser storage — no cookies, no ads, and we never
                                sell your data.
                            </p>
                        </div>
                    </div>
                    <div class="flex justify-end gap-2">
                        <UButton
                            to="/privacy"
                            color="neutral"
                            variant="soft"
                            size="sm"
                            icon="i-lucide-shield-user">
                            Privacy
                        </UButton>
                        <UButton
                            variant="soft"
                            size="sm"
                            icon="i-lucide-check"
                            @click="dismiss">
                            Got it
                        </UButton>
                    </div>
                </div>
            </UCard>
        </div>
    </Transition>
</template>
