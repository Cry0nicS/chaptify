<script setup lang="ts">
/*
 * Example output: a sample audiobook's chapters laid out the way a running watch shows laps —
 * lap number, chapter, length, and a bar for each lap's share of the longest one. It is real data in
 * a real table (with a caption), so it reads correctly without the visuals.
 */
interface ChapterSplit {
    title: string;
    seconds: number;
}

const splits: ChapterSplit[] = [
    {title: "The Start Line", seconds: 44 * 60 + 10},
    {title: "Negative Splits", seconds: 30 * 60 + 52},
    {title: "Hitting the Wall", seconds: 52 * 60 + 42},
    {title: "Second Wind", seconds: 35 * 60 + 42},
    {title: "The Last Mile", seconds: 37 * 60 + 39}
];

const longest = Math.max(...splits.map((split) => split.seconds));
const totalSeconds = splits.reduce((total, split) => total + split.seconds, 0);

const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    const mm = String(minutes).padStart(hours ? 2 : 1, "0");
    const ss = String(rest).padStart(2, "0");

    return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

const lapNumber = (index: number) => String(index + 1).padStart(2, "0");
</script>

<template>
    <div>
        <div class="flex items-baseline justify-between gap-4">
            <p class="micro-label">Example output</p>
            <p class="data-line">
                {{ splits.length }} chapters ·
                <span class="text-highlighted font-semibold">
                    {{ formatDuration(totalSeconds) }}
                </span>
            </p>
        </div>

        <p class="text-muted mt-1 text-sm">A sample audiobook, as its chapters come back.</p>

        <table class="mt-3 w-full border-collapse text-left">
            <caption class="sr-only">
                Example: a five-chapter audiobook shown as laps, with each chapter's length
            </caption>
            <thead>
                <tr class="border-default border-b">
                    <th
                        scope="col"
                        class="micro-label w-12 py-2 font-semibold">
                        Lap
                    </th>
                    <th
                        scope="col"
                        class="micro-label py-2 font-semibold">
                        Chapter
                    </th>
                    <th
                        scope="col"
                        class="micro-label w-20 py-2 text-right font-semibold">
                        Length
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="(split, index) in splits"
                    :key="split.title"
                    class="border-muted border-b last:border-b-0">
                    <td class="stat text-primary py-2.5 text-2xl">{{ lapNumber(index) }}</td>
                    <td class="py-2.5 pr-4">
                        <p class="text-highlighted text-sm font-semibold">{{ split.title }}</p>
                        <div
                            class="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full"
                            aria-hidden="true">
                            <div
                                class="bg-secondary h-full rounded-full"
                                :style="{
                                    width: `${Math.round((split.seconds / longest) * 100)}%`
                                }" />
                        </div>
                    </td>
                    <td class="stat text-highlighted py-2.5 text-right text-xl">
                        {{ formatDuration(split.seconds) }}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
