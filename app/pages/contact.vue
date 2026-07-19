<script setup lang="ts">
import type {FormSubmitEvent} from "@nuxt/ui";
import type {ContactRequest, ContactTopic} from "#shared/utils/types";
import {reactive, ref} from "vue";
import {contactRequestSchema, contactResponseSchema} from "#shared/utils/schemas";

definePageMeta({
    layout: "default"
});

useSeoMeta({
    title: "Chaptify | Contact",
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
    message: ""
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
    submitError.value = null;
    isSent.value = false;
};
</script>

<template>
    <div class="mx-auto max-w-5xl py-10 sm:py-16">
        <section class="max-w-3xl space-y-5">
            <p class="text-primary font-mono text-xs tracking-[0.25em] uppercase">Contact</p>
            <h1
                class="font-display text-highlighted text-4xl font-bold tracking-tight text-balance sm:text-6xl">
                Get in touch.
            </h1>
            <p class="text-muted max-w-2xl text-base sm:text-lg">
                Chaptify is a one-person project, and it improves through messages like yours.
                Feature ideas, bug reports, or a simple hello — all of it lands in the same inbox.
            </p>
        </section>

        <div class="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-16">
            <section
                class="space-y-8"
                aria-labelledby="contact-info">
                <h2
                    id="contact-info"
                    class="sr-only">
                    What to contact us about
                </h2>

                <div class="flex gap-4">
                    <UIcon
                        name="i-lucide-lightbulb"
                        class="text-primary mt-1 size-5 shrink-0" />
                    <div class="space-y-1">
                        <h3 class="text-highlighted font-semibold">Feature suggestions</h3>
                        <p class="text-muted text-sm">
                            Missing a format, a setting, or a whole idea? Describe how you would use
                            it — real listening setups (which watch, which player) make features
                            much easier to build right.
                        </p>
                    </div>
                </div>

                <div class="flex gap-4">
                    <UIcon
                        name="i-lucide-bug"
                        class="text-primary mt-1 size-5 shrink-0" />
                    <div class="space-y-1">
                        <h3 class="text-highlighted font-semibold">Bug reports</h3>
                        <p class="text-muted text-sm">
                            Say what you uploaded (format and rough size), which output format you
                            picked, and what happened instead of chapters. Please don't attach or
                            link the audiobook itself — a description is enough.
                        </p>
                    </div>
                </div>

                <div class="flex gap-4">
                    <UIcon
                        name="i-lucide-message-circle"
                        class="text-primary mt-1 size-5 shrink-0" />
                    <div class="space-y-1">
                        <h3 class="text-highlighted font-semibold">Anything else</h3>
                        <p class="text-muted text-sm">
                            Questions about how Chaptify works, thanks, or stories about where your
                            chapters ended up playing — always welcome.
                        </p>
                    </div>
                </div>

                <div class="border-default space-y-3 border-t pt-6">
                    <h3 class="text-highlighted font-semibold">What to expect</h3>
                    <ul class="text-muted space-y-2 text-sm">
                        <li class="flex gap-3">
                            <UIcon
                                name="i-lucide-inbox"
                                class="text-primary mt-0.5 size-4 shrink-0" />
                            <span>
                                Your message goes straight to the developer's inbox — no ticket
                                system, no autoresponder.
                            </span>
                        </li>
                        <li class="flex gap-3">
                            <UIcon
                                name="i-lucide-clock"
                                class="text-primary mt-0.5 size-4 shrink-0" />
                            <span>
                                Replies usually take a few days. It's one person, sometimes out
                                running.
                            </span>
                        </li>
                        <li class="flex gap-3">
                            <UIcon
                                name="i-lucide-shield-check"
                                class="text-primary mt-0.5 size-4 shrink-0" />
                            <span>
                                Your email address is used only to reply to this message — no lists,
                                no marketing.
                            </span>
                        </li>
                    </ul>
                </div>
            </section>

            <section aria-labelledby="contact-form-title">
                <UCard>
                    <template #header>
                        <h2
                            id="contact-form-title"
                            class="text-highlighted text-lg font-semibold">
                            Send a message
                        </h2>
                        <p class="text-muted text-sm">All fields are required.</p>
                    </template>

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
                            color="neutral"
                            variant="soft"
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
                        <UFormField
                            label="Name"
                            name="name">
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
                            help="Only used to reply to this message.">
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
                            name="topic">
                            <URadioGroup
                                v-model="state.topic"
                                :items="topicItems"
                                :disabled="isSubmitting" />
                        </UFormField>

                        <UFormField
                            label="Message"
                            name="message">
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
                            size="lg"
                            block
                            icon="i-lucide-send"
                            :loading="isSubmitting">
                            Send message
                        </UButton>
                    </UForm>
                </UCard>
            </section>
        </div>
    </div>
</template>
