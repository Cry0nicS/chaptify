<script setup lang="ts">
definePageMeta({
    layout: "default"
});

useSeo({
    title: "About",
    description:
        "Why Chaptify exists: audiobooks split into chapter files so watches and small players can finally play them."
});
</script>

<template>
    <div class="mx-auto max-w-3xl py-10 sm:py-16">
        <section class="space-y-5">
            <p class="text-primary font-mono text-xs tracking-[0.25em] uppercase">About Chaptify</p>
            <h1
                class="font-display text-highlighted text-4xl font-bold tracking-tight text-balance sm:text-6xl">
                Built for the long run.
            </h1>
            <p class="text-muted max-w-2xl text-base sm:text-lg">
                Chaptify takes one audiobook file and turns it into a folder of chapter files —
                because the smallest players are the ones that need chapters the most.
            </p>
        </section>

        <div class="mt-14 space-y-12">
            <section
                class="space-y-3"
                aria-labelledby="about-problem">
                <p class="text-primary font-mono text-xs tracking-widest">CH 01 · THE PROBLEM</p>
                <h2
                    id="about-problem"
                    class="font-display text-highlighted text-2xl font-bold tracking-tight">
                    A marathon is long. A phone is heavy.
                </h2>
                <div class="text-muted space-y-3">
                    <p>
                        Chaptify exists because of marathon training. On a long run, the phone stays
                        home — everything has to fit on the watch: the route, the music, and ideally
                        the audiobook that makes hour three bearable.
                    </p>
                    <p>
                        The catch: most audiobooks come as one single file, hours long, and most
                        wearables simply refuse to play it. A Garmin will happily sync a folder of
                        songs, but hand it a ten-hour M4B and you get silence.
                    </p>
                </div>
            </section>

            <section
                class="space-y-3"
                aria-labelledby="about-fix">
                <p class="text-primary font-mono text-xs tracking-widest">CH 02 · THE FIX</p>
                <h2
                    id="about-fix"
                    class="font-display text-highlighted text-2xl font-bold tracking-tight">
                    Splits — in both senses
                </h2>
                <div class="text-muted space-y-3">
                    <p>
                        In running, splits are how you break an impossible distance into pieces you
                        can handle. Audiobooks needed the same treatment: cut the one big file into
                        its chapters, and suddenly the watch treats it like an album and plays it
                        without complaint.
                    </p>
                    <p>
                        That is everything Chaptify does. It reads the chapter marks already
                        embedded in your M4B or MP3, cuts the audio precisely at each one, zips the
                        chapter files, and emails you a temporary download link. No accounts, no
                        library, no cloud storage of your books.
                    </p>
                </div>
            </section>

            <section
                class="space-y-3"
                aria-labelledby="about-everyone">
                <p class="text-primary font-mono text-xs tracking-widest">CH 03 · FOR EVERYONE</p>
                <h2
                    id="about-everyone"
                    class="font-display text-highlighted text-2xl font-bold tracking-tight">
                    Made for one Garmin, shared with all of them
                </h2>
                <div class="text-muted space-y-3">
                    <p>
                        The first version was a script that solved exactly one runner's problem. But
                        the problem isn't rare — runners, cyclists, swimmers, anyone with a wearable
                        or an older MP3 player hits the same wall. So the script became this site,
                        free for anyone to use.
                    </p>
                </div>
            </section>

            <section
                class="border-default space-y-4 border-t pt-10"
                aria-labelledby="about-fine-print">
                <h2
                    id="about-fine-print"
                    class="font-display text-highlighted text-2xl font-bold tracking-tight">
                    The fine print
                </h2>
                <ul class="text-muted space-y-3 text-sm">
                    <li class="flex gap-3">
                        <UIcon
                            name="i-lucide-bookmark"
                            class="text-primary mt-0.5 size-4 shrink-0" />
                        <span>
                            Your audiobook needs embedded chapter marks. Chaptify cuts where the
                            book says its chapters are — it doesn't guess from silence or use AI to
                            invent chapter breaks.
                        </span>
                    </li>
                    <li class="flex gap-3">
                        <UIcon
                            name="i-lucide-timer"
                            class="text-primary mt-0.5 size-4 shrink-0" />
                        <span>
                            Nothing is stored permanently. The generated ZIP and its download link
                            expire after 12 hours, and your upload is deleted with them.
                        </span>
                    </li>
                    <li class="flex gap-3">
                        <UIcon
                            name="i-lucide-shield-check"
                            class="text-primary mt-0.5 size-4 shrink-0" />
                        <span>
                            Only upload audiobooks you own or are authorized to process. Chaptify
                            splits files; it doesn't remove copy protection.
                        </span>
                    </li>
                </ul>
            </section>
        </div>

        <div class="mt-12">
            <UButton
                to="/"
                size="lg"
                icon="i-lucide-scissors">
                Split an audiobook
            </UButton>
        </div>
    </div>
</template>
