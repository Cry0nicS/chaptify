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
</script>

<template>
    <div class="mx-auto max-w-3xl py-10 sm:py-16">
        <section class="space-y-5">
            <p class="text-primary font-mono text-xs tracking-[0.25em] uppercase">Privacy</p>
            <h1
                class="font-display text-highlighted text-4xl font-bold tracking-tight text-balance sm:text-6xl">
                Your data, kept simple.
            </h1>
            <p class="text-muted max-w-2xl text-base sm:text-lg">
                This page is information, not a consent form. Chaptify only handles the data it
                needs to do its job, and there is nothing to opt in or out of because there is no
                tracking, advertising, or profiling to switch off.
            </p>
        </section>

        <div class="mt-14 space-y-12">
            <section
                class="space-y-3"
                aria-labelledby="privacy-short">
                <h2
                    id="privacy-short"
                    class="font-display text-highlighted text-2xl font-bold tracking-tight">
                    The short version
                </h2>
                <ul class="text-muted space-y-3 text-sm">
                    <li class="flex gap-3">
                        <UIcon
                            name="i-lucide-cookie"
                            class="text-primary mt-0.5 size-4 shrink-0" />
                        <span>
                            No cookies. Chaptify uses a little browser storage to work, but never
                            cookies, and nothing that follows you across sites.
                        </span>
                    </li>
                    <li class="flex gap-3">
                        <UIcon
                            name="i-lucide-eye-off"
                            class="text-primary mt-0.5 size-4 shrink-0" />
                        <span>No advertising, no third-party trackers, and no profiling.</span>
                    </li>
                    <li class="flex gap-3">
                        <UIcon
                            name="i-lucide-ban"
                            class="text-primary mt-0.5 size-4 shrink-0" />
                        <span>We never sell or rent your data.</span>
                    </li>
                    <li class="flex gap-3">
                        <UIcon
                            name="i-lucide-file-audio"
                            class="text-primary mt-0.5 size-4 shrink-0" />
                        <span>
                            Your uploaded audio and its download link are deleted after 12 hours.
                        </span>
                    </li>
                </ul>
            </section>

            <section
                class="space-y-3"
                aria-labelledby="privacy-what">
                <h2
                    id="privacy-what"
                    class="font-display text-highlighted text-2xl font-bold tracking-tight">
                    What we process, and why
                </h2>
                <div class="text-muted space-y-4 text-sm">
                    <p>
                        <span class="text-highlighted">Your upload and email.</span>
                        When you split or convert an audiobook, we receive the audio file and the
                        email address you enter. We use them to process the file and to email you
                        the download link. The legal basis is performing the service you asked for.
                    </p>
                    <p>
                        <span class="text-highlighted">Download links.</span>
                        We store only hashed, irreversible versions of the tokens in your download
                        links, so a link can be validated without keeping the secret itself.
                    </p>
                    <p>
                        <span class="text-highlighted">Server logs.</span>
                        Our server records technical request data, including IP addresses, to run
                        the service securely and diagnose problems. The legal basis is our
                        legitimate interest in a working, abuse-resistant service.
                    </p>
                </div>
            </section>

            <section
                class="space-y-3"
                aria-labelledby="privacy-keep">
                <h2
                    id="privacy-keep"
                    class="font-display text-highlighted text-2xl font-bold tracking-tight">
                    What we keep, and for how long
                </h2>
                <div class="text-muted space-y-4 text-sm">
                    <p>
                        <span class="text-highlighted">Your audio and results.</span>
                        The uploaded file, the generated files, and the download link are deleted
                        automatically 12 hours after your job is ready, or immediately if you use
                        the "Delete now" button.
                    </p>
                    <p>
                        <span class="text-highlighted">Upload record.</span>
                        To run and improve Chaptify, we keep a short record of each upload — the
                        email you provided and the book title from the filename, plus technical
                        details like file size and duration. We use it only to operate the service;
                        we never use it for marketing and never sell it.
                    </p>
                </div>
            </section>

            <section
                class="space-y-3"
                aria-labelledby="privacy-storage">
                <h2
                    id="privacy-storage"
                    class="font-display text-highlighted text-2xl font-bold tracking-tight">
                    Storage in your browser
                </h2>
                <div class="text-muted space-y-3 text-sm">
                    <p>
                        Chaptify uses no cookies. It uses two kinds of browser storage, both only to
                        make the app work:
                    </p>
                    <ul class="space-y-2">
                        <li class="flex gap-3">
                            <UIcon
                                name="i-lucide-palette"
                                class="text-primary mt-0.5 size-4 shrink-0" />
                            <span>
                                <span class="text-highlighted">Theme preference</span>
                                remembers whether you chose light or dark mode, stored in your
                                browser's local storage.
                            </span>
                        </li>
                        <li class="flex gap-3">
                            <UIcon
                                name="i-lucide-loader"
                                class="text-primary mt-0.5 size-4 shrink-0" />
                            <span>
                                <span class="text-highlighted">Active job</span>
                                remembers the job you are processing so this tab can show its
                                progress and let you download it, stored in session storage and
                                cleared when you close the tab.
                            </span>
                        </li>
                    </ul>
                    <p>
                        Because this storage is strictly necessary to provide the service you
                        requested, it does not require consent — which is why you see an information
                        notice rather than a consent banner.
                    </p>
                </div>
            </section>

            <section
                class="space-y-3"
                aria-labelledby="privacy-share">
                <h2
                    id="privacy-share"
                    class="font-display text-highlighted text-2xl font-bold tracking-tight">
                    Who we share data with
                </h2>
                <div class="text-muted space-y-3 text-sm">
                    <p>
                        We do not sell your data or share it with advertisers. We rely on a small
                        number of service providers who process data only on our behalf:
                    </p>
                    <ul class="space-y-2">
                        <li class="flex gap-3">
                            <UIcon
                                name="i-lucide-server"
                                class="text-primary mt-0.5 size-4 shrink-0" />
                            <span>
                                <span class="text-highlighted">Hetzner</span>
                                provides hosting, in Germany.
                            </span>
                        </li>
                        <li class="flex gap-3">
                            <UIcon
                                name="i-lucide-mail"
                                class="text-primary mt-0.5 size-4 shrink-0" />
                            <span>
                                <span class="text-highlighted">Mailgun</span>
                                sends the completion email containing your download link, using EU
                                infrastructure.
                            </span>
                        </li>
                        <li class="flex gap-3">
                            <UIcon
                                name="i-lucide-globe"
                                class="text-primary mt-0.5 size-4 shrink-0" />
                            <span>
                                <span class="text-highlighted">Cloudflare</span>
                                manages the domain's DNS.
                            </span>
                        </li>
                    </ul>
                </div>
            </section>

            <section
                class="space-y-3"
                aria-labelledby="privacy-rights">
                <h2
                    id="privacy-rights"
                    class="font-display text-highlighted text-2xl font-bold tracking-tight">
                    Your rights
                </h2>
                <div class="text-muted space-y-3 text-sm">
                    <p>
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
                </div>
            </section>

            <section
                class="border-default space-y-3 border-t pt-10"
                aria-labelledby="privacy-changes">
                <h2
                    id="privacy-changes"
                    class="font-display text-highlighted text-2xl font-bold tracking-tight">
                    Changes to this notice
                </h2>
                <div class="text-muted space-y-3 text-sm">
                    <p>
                        If what we do with data changes, we will update this page. Last updated
                        {{ lastUpdated }}.
                    </p>
                </div>
            </section>
        </div>
    </div>
</template>
