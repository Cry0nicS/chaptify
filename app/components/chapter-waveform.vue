<script setup lang="ts">
/*
 * Decorative hero illustration: one continuous waveform that gets cut into labeled
 * chapter segments on load. Bar heights are hardcoded so SSR and client render the
 * same markup (no hydration mismatch, no Math.random).
 */
interface WaveformChapter {
    label: string;
    startTime: string;
    bars: number[];
}

const chapters: WaveformChapter[] = [
    {label: "CH 01", startTime: "0:00", bars: [32, 55, 70, 48, 62, 80, 58, 40, 66, 50]},
    {label: "CH 02", startTime: "44:10", bars: [28, 46, 64, 78, 56, 70, 44]},
    {
        label: "CH 03",
        startTime: "1:15:02",
        bars: [60, 38, 52, 74, 88, 64, 46, 58, 72, 50, 34, 62]
    },
    {label: "CH 04", startTime: "2:07:44", bars: [42, 68, 54, 80, 60, 36, 58, 46]},
    {label: "CH 05", startTime: "2:43:26", bars: [30, 52, 66, 44, 58, 38]}
];

const barDelay = (chapterIndex: number, barIndex: number) => {
    const barsBefore = chapters
        .slice(0, chapterIndex)
        .reduce((total, chapter) => total + chapter.bars.length, 0);

    return `${(barsBefore + barIndex) * 18}ms`;
};

const splitDelay = (chapterIndex: number) => `${900 + chapterIndex * 140}ms`;

// Signature: the book flows through the brand's blue→violet gradient as it splits — each chapter is
// a step from azure (start) toward iris (end), mirroring the logo gradient.
const chapterColor = (chapterIndex: number) => {
    const azurePercent = Math.round((1 - chapterIndex / (chapters.length - 1)) * 100);

    return `color-mix(in oklab, var(--color-azure-500) ${azurePercent}%, var(--color-iris-500))`;
};
</script>

<template>
    <div
        class="waveform flex items-end"
        aria-hidden="true">
        <div
            v-for="(chapter, chapterIndex) in chapters"
            :key="chapter.label"
            class="waveform-chapter min-w-0"
            :class="chapterIndex > 0 ? 'waveform-chapter-split' : ''"
            :style="{
                'flexGrow': chapter.bars.length,
                'flexBasis': 0,
                '--split-delay': splitDelay(chapterIndex)
            }">
            <div class="flex h-16 items-end gap-px sm:h-20 sm:gap-0.5">
                <span
                    v-for="(bar, barIndex) in chapter.bars"
                    :key="barIndex"
                    class="waveform-bar min-w-0 flex-1 rounded-full"
                    :class="chapterIndex % 2 === 0 ? 'opacity-90' : 'opacity-60'"
                    :style="{
                        'height': `${bar}%`,
                        'backgroundColor': chapterColor(chapterIndex),
                        '--bar-delay': barDelay(chapterIndex, barIndex)
                    }" />
            </div>
            <p
                class="waveform-label text-dimmed mt-2 truncate font-mono text-[10px] tracking-widest sm:text-xs">
                {{ chapter.label }}
                <span
                    v-if="chapter.bars.length >= 8"
                    class="text-muted hidden lg:inline">
                    · {{ chapter.startTime }}
                </span>
            </p>
        </div>
    </div>
</template>

<style scoped>
.waveform-chapter-split {
    margin-left: 0.625rem;
    border-left: 1px dashed
        color-mix(in srgb, var(--ui-primary, var(--color-iris-500)) 45%, transparent);
    padding-left: 0.625rem;
}

@media (prefers-reduced-motion: no-preference) {
    .waveform-bar {
        animation: waveform-rise 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
        animation-delay: var(--bar-delay);
        transform-origin: bottom;
    }

    .waveform-chapter-split {
        animation: waveform-split 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
        animation-delay: var(--split-delay);
    }

    .waveform-label {
        animation: waveform-fade 480ms ease-out both;
        animation-delay: calc(var(--split-delay, 900ms) + 260ms);
    }
}

@keyframes waveform-rise {
    from {
        transform: scaleY(0.12);
    }

    to {
        transform: scaleY(1);
    }
}

@keyframes waveform-split {
    from {
        margin-left: 0;
        padding-left: 0;
        border-left-color: transparent;
    }

    to {
        margin-left: 0.625rem;
        padding-left: 0.625rem;
    }
}

@keyframes waveform-fade {
    from {
        opacity: 0;
        transform: translateY(4px);
    }

    to {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>
