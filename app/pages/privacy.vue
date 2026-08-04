<script setup lang="ts">
definePageMeta({
    layout: "default"
});

useSeo({
    title: "Privacy",
    description:
        "How Chaptify handles your data: no cookies, no tracking, no ads, and nothing sold. Plain-language information about what we process and why."
});

// Bump when the notice content changes.
const lastUpdated = "21 July 2026";

const shortVersion = [
    {
        icon: "i-lucide-cookie",
        text: "No cookies. Chaptify uses a little browser storage to work, but never cookies, and nothing that follows you across sites."
    },
    {
        icon: "i-lucide-eye-off",
        text: "No advertising, no profiling, and no cross-site tracking — only anonymous, cookie-free page statistics."
    },
    {icon: "i-lucide-ban", text: "We never sell or rent your data."},
    {
        icon: "i-lucide-file-audio",
        text: "Your uploaded audio and its download link are deleted after 12 hours."
    },
    {
        icon: "i-lucide-mail-x",
        text: "Your email address is deleted as soon as we have sent you the download link. We keep only non-identifying service statistics."
    }
];

const processors = [
    {icon: "i-lucide-server", name: "Hetzner", text: "provides hosting, in Germany."},
    {
        icon: "i-lucide-mail",
        name: "Mailgun",
        text: "sends the completion email containing your download link, using EU infrastructure."
    },
    {
        icon: "i-lucide-globe",
        name: "Cloudflare",
        text: "manages the domain's DNS and provides the cookie-free, anonymous web analytics described above."
    }
];
</script>

<template>
    <div class="pb-16">
        <section class="pt-12 pb-2 lg:pt-16">
            <h1
                class="font-display text-highlighted max-w-[20ch] text-4xl font-bold tracking-[-0.042em] text-balance sm:text-5xl lg:text-6xl">
                Your data, kept simple.
            </h1>
            <p class="text-toned mt-6 max-w-[56ch] text-base sm:text-lg">
                This page is information, not a consent form. Chaptify only handles the data it
                needs to do its job, and there is nothing to opt in or out of because there is no
                tracking, advertising, or profiling to switch off.
            </p>
        </section>

        <div class="grid gap-10 pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.6fr)] lg:gap-14">
            <div class="max-w-[64ch]">
                <section aria-labelledby="privacy-what">
                    <h2
                        id="privacy-what"
                        class="font-display text-highlighted text-2xl font-bold tracking-[-0.03em] text-balance sm:text-3xl">
                        What we process, and why
                    </h2>
                    <div class="text-toned mt-4 space-y-4">
                        <p>
                            <span class="text-highlighted font-semibold">
                                Your upload and email.
                            </span>
                            When you split or convert an audiobook, we receive the audio file and
                            the email address you enter. We use them to process the file and to
                            email you the download link. The legal basis is performing the service
                            you asked for.
                        </p>
                        <p>
                            <span class="text-highlighted font-semibold">Download links.</span>
                            We store only hashed, irreversible versions of the tokens in your
                            download links, so a link can be validated without keeping the secret
                            itself.
                        </p>
                        <p>
                            <span class="text-highlighted font-semibold">Server logs.</span>
                            Our server records technical request data, including IP addresses, to
                            run the service securely and diagnose problems. The legal basis is our
                            legitimate interest in a working, abuse-resistant service.
                        </p>
                        <p>
                            <span class="text-highlighted font-semibold">
                                Anonymous usage statistics.
                            </span>
                            We use Cloudflare Web Analytics to count page views and measure how fast
                            the site loads. It sets no cookies, stores nothing in your browser, and
                            does not fingerprint or identify you — we only ever see aggregate
                            numbers. The legal basis is our legitimate interest in understanding how
                            the site is used and performing.
                        </p>
                    </div>
                </section>

                <section
                    class="mt-12"
                    aria-labelledby="privacy-keep">
                    <h2
                        id="privacy-keep"
                        class="font-display text-highlighted text-2xl font-bold tracking-[-0.03em] text-balance sm:text-3xl">
                        What we keep, and for how long
                    </h2>
                    <div class="text-toned mt-4 space-y-4">
                        <p>
                            <span class="text-highlighted font-semibold">
                                Your audio and results.
                            </span>
                            The uploaded file, the generated files, and the download link are
                            deleted automatically 12 hours after your job is ready, or immediately
                            if you use the "Delete now" button.
                        </p>
                        <p>
                            <span class="text-highlighted font-semibold">Your email.</span>
                            We use it only to send you the download link, and delete it as soon as
                            that email has been sent — or when the download link expires, if we
                            could not deliver it.
                        </p>
                        <p>
                            <span class="text-highlighted font-semibold">Upload record.</span>
                            To run and improve Chaptify, we keep only non-identifying service
                            statistics about each upload — the book title from the filename, plus
                            technical details like file size and duration. We use them only to
                            operate the service; we never use them for marketing and never sell
                            them.
                        </p>
                    </div>
                </section>

                <section
                    class="mt-12"
                    aria-labelledby="privacy-storage">
                    <h2
                        id="privacy-storage"
                        class="font-display text-highlighted text-2xl font-bold tracking-[-0.03em] text-balance sm:text-3xl">
                        Storage in your browser
                    </h2>
                    <div class="text-toned mt-4 space-y-4">
                        <p>
                            Chaptify uses no cookies. It uses two kinds of browser storage, both
                            only to make the app work:
                        </p>
                        <ul class="space-y-3">
                            <li class="flex gap-3">
                                <UIcon
                                    name="i-lucide-palette"
                                    class="text-secondary mt-1 size-4 shrink-0" />
                                <span>
                                    <span class="text-highlighted font-semibold">
                                        Theme preference
                                    </span>
                                    remembers whether you chose light or dark mode, stored in your
                                    browser's local storage.
                                </span>
                            </li>
                            <li class="flex gap-3">
                                <UIcon
                                    name="i-lucide-loader"
                                    class="text-secondary mt-1 size-4 shrink-0" />
                                <span>
                                    <span class="text-highlighted font-semibold">Active job</span>
                                    remembers the job you are processing so this tab can show its
                                    progress and let you download it, stored in session storage and
                                    cleared when you close the tab.
                                </span>
                            </li>
                        </ul>
                        <p>
                            Because this storage is strictly necessary to provide the service you
                            requested, it does not require consent — which is why you see an
                            information notice rather than a consent banner.
                        </p>
                    </div>
                </section>

                <section
                    class="mt-12"
                    aria-labelledby="privacy-rights">
                    <h2
                        id="privacy-rights"
                        class="font-display text-highlighted text-2xl font-bold tracking-[-0.03em] text-balance sm:text-3xl">
                        Your rights
                    </h2>
                    <p class="text-toned mt-4">
                        Under the GDPR you can ask us to access, correct, or delete your personal
                        data, to restrict or object to its processing, and to receive a copy of it.
                        You can make any of these requests, or ask a question, through the
                        <ULink
                            to="/contact"
                            class="text-primary font-medium">
                            contact page
                        </ULink>
                        at any time. You also have the right to lodge a complaint with a data
                        protection supervisory authority.
                    </p>
                </section>

                <section
                    class="border-default mt-12 border-t pt-8"
                    aria-labelledby="privacy-changes">
                    <h2
                        id="privacy-changes"
                        class="text-highlighted text-lg font-semibold tracking-tight">
                        Changes to this notice
                    </h2>
                    <p class="text-muted mt-2 text-sm">
                        If what we do with data changes, we will update this page.
                    </p>
                    <p class="data-line mt-3">Last updated {{ lastUpdated }}</p>
                </section>
            </div>

            <aside class="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
                <div class="pane p-6">
                    <p class="micro-label">The short version</p>
                    <ul class="text-toned mt-5 space-y-4 text-sm">
                        <li
                            v-for="item in shortVersion"
                            :key="item.icon"
                            class="flex gap-3">
                            <UIcon
                                :name="item.icon"
                                class="text-primary mt-0.5 size-4 shrink-0" />
                            <span>{{ item.text }}</span>
                        </li>
                    </ul>
                </div>

                <div
                    class="pane-quiet border-default border p-6"
                    aria-labelledby="privacy-share">
                    <h2
                        id="privacy-share"
                        class="micro-label">
                        Who we share data with
                    </h2>
                    <p class="text-muted mt-4 text-sm">
                        We do not sell your data or share it with advertisers. We rely on a small
                        number of service providers who process data only on our behalf:
                    </p>
                    <ul class="text-toned mt-4 space-y-3 text-sm">
                        <li
                            v-for="processor in processors"
                            :key="processor.name"
                            class="flex gap-3">
                            <UIcon
                                :name="processor.icon"
                                class="text-secondary mt-0.5 size-4 shrink-0" />
                            <span>
                                <span class="text-highlighted font-semibold">
                                    {{ processor.name }}
                                </span>
                                {{ processor.text }}
                            </span>
                        </li>
                    </ul>
                </div>
            </aside>
        </div>
    </div>
</template>
