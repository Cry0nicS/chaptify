<script setup lang="ts">
definePageMeta({
    layout: "default"
});

useSeo({
    title: "About",
    description:
        "Why Chaptify exists: audiobooks split into chapter files so watches and small players can finally play them."
});

const finePrint = [
    {
        icon: "i-lucide-bookmark",
        title: "Chapter marks required",
        body: "Chaptify cuts where the book says its chapters are. It does not guess from silence or use AI to invent breaks — though it can fall back to fixed 30-minute parts if you ask it to.",
        data: "300 marks max"
    },
    {
        icon: "i-lucide-timer",
        title: "Nothing is kept",
        body: "The generated archive and its download link expire after 12 hours, and your uploaded file is deleted with them. You can also delete everything the moment it is ready.",
        data: "TTL 12 h"
    },
    {
        icon: "i-lucide-shield-check",
        title: "Only what you own",
        body: "Upload audiobooks you own or are authorised to process. Chaptify splits and converts files; it does not remove copy protection.",
        data: "no DRM removal"
    }
];
</script>

<template>
    <div class="pb-16">
        <section class="pt-12 pb-2 lg:pt-16">
            <h1
                class="font-display text-highlighted max-w-[22ch] text-4xl font-bold tracking-[-0.042em] text-balance sm:text-5xl lg:text-6xl">
                Built for the long run.
            </h1>
            <p class="text-toned mt-6 max-w-[54ch] text-base sm:text-lg">
                Chaptify takes one audiobook file and turns it into a folder of chapter files —
                because the smallest players are the ones that need chapters the most.
            </p>
        </section>

        <div class="grid gap-10 pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)] lg:gap-16">
            <div class="max-w-[64ch]">
                <section aria-labelledby="about-problem">
                    <h2
                        id="about-problem"
                        class="font-display text-highlighted text-2xl font-bold tracking-[-0.03em] text-balance sm:text-3xl">
                        A marathon is long. A phone is heavy.
                    </h2>
                    <div class="text-toned mt-4 space-y-4">
                        <p>
                            Chaptify exists because of marathon training. On a long run the phone
                            stays home — everything has to fit on the watch: the route, the music,
                            and ideally the audiobook that makes hour three bearable.
                        </p>
                        <p>
                            The catch: most audiobooks come as one single file, hours long, and most
                            wearables simply refuse to play it. A Garmin will happily sync a folder
                            of songs, but hand it a ten-hour M4B and you get silence.
                        </p>
                    </div>
                </section>

                <section
                    class="mt-12"
                    aria-labelledby="about-fix">
                    <h2
                        id="about-fix"
                        class="font-display text-highlighted text-2xl font-bold tracking-[-0.03em] text-balance sm:text-3xl">
                        Splits — in both senses
                    </h2>
                    <div class="text-toned mt-4 space-y-4">
                        <p>
                            In running, splits are how you break an impossible distance into pieces
                            you can handle. Audiobooks needed the same treatment: cut the one big
                            file into its chapters, and suddenly the watch treats it like an album
                            and plays it without complaint.
                        </p>
                        <p>
                            That is everything Chaptify does. It reads the chapter marks already
                            embedded in your M4B or MP3, cuts the audio precisely at each one, zips
                            the chapter files, and emails you a temporary download link. No
                            accounts, no library, no cloud storage of your books.
                        </p>
                    </div>
                </section>

                <section
                    class="mt-12"
                    aria-labelledby="about-everyone">
                    <h2
                        id="about-everyone"
                        class="font-display text-highlighted text-2xl font-bold tracking-[-0.03em] text-balance sm:text-3xl">
                        Made for one Garmin, shared with all of them
                    </h2>
                    <div class="text-toned mt-4 space-y-4">
                        <p>
                            The first version was a script that solved exactly one runner's problem.
                            But the problem isn't rare — runners, cyclists, swimmers, anyone with a
                            wearable or an older MP3 player hits the same wall. So the script became
                            this site, free for anyone to use.
                        </p>
                    </div>
                </section>
            </div>

            <aside class="lg:sticky lg:top-24 lg:self-start">
                <div class="pane p-6">
                    <p class="micro-label">The fine print</p>
                    <ul class="mt-5 space-y-6">
                        <li
                            v-for="item in finePrint"
                            :key="item.title">
                            <div class="flex items-center gap-2.5">
                                <UIcon
                                    :name="item.icon"
                                    class="text-primary size-4 shrink-0" />
                                <h2 class="text-highlighted font-semibold">{{ item.title }}</h2>
                            </div>
                            <p class="text-muted mt-2 text-sm">{{ item.body }}</p>
                            <p class="data-line data-line-accent mt-2">{{ item.data }}</p>
                        </li>
                    </ul>
                </div>
            </aside>
        </div>

        <section
            class="pane mt-14 grid gap-8 p-8 sm:p-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center lg:gap-14">
            <div>
                <h2
                    class="font-display text-highlighted max-w-[24ch] text-2xl font-bold tracking-[-0.03em] text-balance sm:text-3xl">
                    Your turn — one file, one address
                </h2>
                <p class="text-toned mt-4 max-w-[52ch]">
                    Chaptify improves through the people who use it. If something didn't split the
                    way it should, a short message steers what gets built next.
                </p>
            </div>
            <div class="flex flex-col items-start gap-3">
                <UButton
                    class="action-pill"
                    to="/"
                    size="lg"
                    icon="i-lucide-scissors">
                    Split an audiobook
                </UButton>
                <UButton
                    to="/contact"
                    color="neutral"
                    variant="ghost"
                    size="lg"
                    icon="i-lucide-message-square-plus">
                    Suggest a feature or report a bug
                </UButton>
            </div>
        </section>
    </div>
</template>
