<script setup lang="ts">
import type {FormSubmitEvent} from "@nuxt/ui";
import type {ContactRequest, ContactTopic} from "#shared/utils/types";
import {reactive, ref} from "vue";
import {contactRequestSchema, contactResponseSchema} from "#shared/utils/schemas";

definePageMeta({
    layout: "default"
});

useSeo({
    title: "Contact",
    description:
        "Suggest a feature, report a bug, or say hello — messages go straight to the developer's inbox."
});

const topicItems: {label: string; description: string; value: ContactTopic}[] = [
    {
        label: "Feature suggestion",
        description: "An idea that would make Chaptify more useful.",
        value: "feature"
    },
    {
        label: "Bug report",
        description: "Something did not work the way it should.",
        value: "bug"
    },
    {
        label: "Other",
        description: "Anything else — questions, feedback, hello.",
        value: "other"
    }
];

const state = reactive({
    name: "",
    email: "",
    topic: undefined as ContactTopic | undefined,
    message: "",
    // Honeypot — stays empty for humans; the server silently discards submissions that fill it.
    website: ""
});

const isSubmitting = ref(false);
const isSent = ref(false);
const submitError = ref<string | null>(null);

const messageFromApiError = (error: unknown): string => {
    const fallback = "Your message could not be sent right now. Please try again later.";

    if (!error || typeof error !== "object") {
        return fallback;
    }

    // ofetch exposes the parsed h3 error body on `data`; the API's payload sits in `data.data`.
    const body = (error as {data?: unknown}).data;
    const candidates = [body, (body as {data?: unknown} | undefined)?.data];

    for (const candidate of candidates) {
        if (candidate && typeof candidate === "object") {
            const message = (candidate as {error?: {message?: unknown}}).error?.message;

            if (typeof message === "string" && message) {
                return message;
            }
        }
    }

    return fallback;
};

const onSubmit = async (event: FormSubmitEvent<ContactRequest>) => {
    submitError.value = null;
    isSubmitting.value = true;

    try {
        const response = await $fetch<unknown>("/api/contact", {
            method: "POST",
            body: event.data
        });
        contactResponseSchema.parse(response);
        isSent.value = true;
    } catch (error) {
        submitError.value = messageFromApiError(error);
    } finally {
        isSubmitting.value = false;
    }
};

const sendAnother = () => {
    state.name = "";
    state.email = "";
    state.topic = undefined;
    state.message = "";
    state.website = "";
    submitError.value = null;
    isSent.value = false;
};
</script>

<template>
    <div class="pb-16">
        <section class="pt-12 pb-2 lg:pt-16">
            <h1
                class="font-display text-highlighted max-w-[18ch] text-4xl font-bold tracking-[-0.042em] text-balance sm:text-5xl lg:text-6xl">
                Get in touch.
            </h1>
            <p class="text-toned mt-6 max-w-[54ch] text-base sm:text-lg">
                Chaptify is a one-person project, and it improves through messages like yours.
                Feature ideas, bug reports, or a simple hello — all of it lands in the same inbox.
            </p>
        </section>

        <div class="grid gap-10 pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(26rem,0.95fr)] lg:gap-14">
            <section
                class="flex flex-col gap-5"
                aria-labelledby="contact-info">
                <h2
                    id="contact-info"
                    class="sr-only">
                    What to contact us about
                </h2>

                <div class="pane pane-lift p-6">
                    <div class="flex items-center gap-2.5">
                        <UIcon
                            name="i-lucide-lightbulb"
                            class="text-primary size-4 shrink-0" />
                        <h3 class="text-highlighted font-semibold">Feature suggestions</h3>
                    </div>
                    <p class="text-muted mt-2.5 text-sm">
                        Missing a format, a setting, or a whole idea? Describe how you would use it
                        — real listening setups (which watch, which player) make features much
                        easier to build right.
                    </p>
                </div>

                <div class="pane pane-lift p-6">
                    <div class="flex items-center gap-2.5">
                        <UIcon
                            name="i-lucide-bug"
                            class="text-primary size-4 shrink-0" />
                        <h3 class="text-highlighted font-semibold">Bug reports</h3>
                    </div>
                    <p class="text-muted mt-2.5 text-sm">
                        Say what you uploaded (format and rough size), which output format you
                        picked, and what happened instead of chapters. Please don't attach or link
                        the audiobook itself — a description is enough.
                    </p>
                </div>

                <div class="pane pane-lift p-6">
                    <div class="flex items-center gap-2.5">
                        <UIcon
                            name="i-lucide-message-circle"
                            class="text-primary size-4 shrink-0" />
                        <h3 class="text-highlighted font-semibold">Anything else</h3>
                    </div>
                    <p class="text-muted mt-2.5 text-sm">
                        Questions about how Chaptify works, thanks, or stories about where your
                        chapters ended up playing — always welcome.
                    </p>
                </div>

                <div class="pane-quiet border-default border p-6">
                    <p class="micro-label">What to expect</p>
                    <ul class="text-muted mt-4 space-y-3 text-sm">
                        <li class="flex gap-3">
                            <UIcon
                                name="i-lucide-inbox"
                                class="text-secondary mt-0.5 size-4 shrink-0" />
                            <span>
                                Your message goes straight to the developer's inbox — no ticket
                                system, no autoresponder.
                            </span>
                        </li>
                        <li class="flex gap-3">
                            <UIcon
                                name="i-lucide-clock"
                                class="text-secondary mt-0.5 size-4 shrink-0" />
                            <span>
                                Replies usually take a few days. It's one person, sometimes out
                                running.
                            </span>
                        </li>
                        <li class="flex gap-3">
                            <UIcon
                                name="i-lucide-shield-check"
                                class="text-secondary mt-0.5 size-4 shrink-0" />
                            <span>
                                Your email address is used only to reply to this message — no lists,
                                no marketing.
                            </span>
                        </li>
                    </ul>
                </div>
            </section>

            <section
                class="lg:sticky lg:top-24 lg:self-start"
                aria-labelledby="contact-form-title">
                <div class="pane pane-front p-5 sm:p-6">
                    <div class="mb-5">
                        <h2
                            id="contact-form-title"
                            class="text-highlighted text-lg font-semibold tracking-tight">
                            Send a message
                        </h2>
                        <p class="data-line mt-1">All fields are required</p>
                    </div>

                    <div
                        v-if="isSent"
                        class="space-y-4">
                        <UAlert
                            color="success"
                            variant="soft"
                            icon="i-lucide-mail-check"
                            title="Message sent"
                            description="Thanks for taking the time. If a reply is needed, it will come to the address you entered." />
                        <UButton
                            type="button"
                            class="rounded-full"
                            color="neutral"
                            variant="subtle"
                            icon="i-lucide-pen-line"
                            @click="sendAnother">
                            Write another message
                        </UButton>
                    </div>

                    <UForm
                        v-else
                        :schema="contactRequestSchema"
                        :state="state"
                        class="space-y-6"
                        @submit="onSubmit">
                        <div
                            class="absolute -left-[9999px] h-px w-px overflow-hidden"
                            aria-hidden="true">
                            <label for="contact-website">Website</label>
                            <input
                                id="contact-website"
                                v-model="state.website"
                                type="text"
                                name="website"
                                tabindex="-1"
                                autocomplete="off" />
                        </div>

                        <UFormField
                            label="Name"
                            name="name"
                            :ui="{label: 'micro-label'}">
                            <UInput
                                v-model="state.name"
                                class="w-full"
                                autocomplete="name"
                                placeholder="How should the reply address you?"
                                :disabled="isSubmitting" />
                        </UFormField>

                        <UFormField
                            label="Email address"
                            name="email"
                            help="Only used to reply to this message."
                            :ui="{label: 'micro-label'}">
                            <UInput
                                v-model="state.email"
                                type="email"
                                class="w-full"
                                autocomplete="email"
                                placeholder="you@example.com"
                                :disabled="isSubmitting" />
                        </UFormField>

                        <UFormField
                            label="What is this about?"
                            name="topic"
                            :ui="{label: 'micro-label'}">
                            <URadioGroup
                                v-model="state.topic"
                                :items="topicItems"
                                :disabled="isSubmitting" />
                        </UFormField>

                        <UFormField
                            label="Message"
                            name="message"
                            :ui="{label: 'micro-label'}">
                            <UTextarea
                                v-model="state.message"
                                class="w-full"
                                :rows="6"
                                placeholder="What happened, or what should exist?"
                                :disabled="isSubmitting" />
                        </UFormField>

                        <UAlert
                            v-if="submitError"
                            color="error"
                            variant="soft"
                            icon="i-lucide-circle-alert"
                            title="Message not sent"
                            :description="submitError"
                            role="alert" />

                        <UButton
                            type="submit"
                            class="action-pill"
                            size="lg"
                            block
                            icon="i-lucide-send"
                            :loading="isSubmitting">
                            Send message
                        </UButton>
                    </UForm>
                </div>
            </section>
        </div>
    </div>
</template>
