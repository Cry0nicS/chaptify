<!--
    The Chaptify mark: a play button cut into three uneven chapters, the middle one mint. It is the
    same symbol as public/favicon.svg and the app icons, so keep the three in sync. Decorative: it
    always sits beside the visible "Chaptify" wordmark, which names the link.
-->
<template>
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        aria-hidden="true"
        focusable="false">
        <defs>
            <clipPath id="chaptify-mark-play">
                <path d="M10.4 7.6 L25.2 16 L10.4 24.4 Z" />
            </clipPath>
        </defs>
        <rect
            width="32"
            height="32"
            rx="7.5"
            fill="#5b3ae0" />
        <g clip-path="url(#chaptify-mark-play)">
            <rect
                x="10"
                y="6"
                width="5.2"
                height="20"
                fill="#ffffff" />
            <rect
                x="16.8"
                y="6"
                width="3.9"
                height="20"
                fill="#63dcbd" />
            <rect
                x="22.3"
                y="6"
                width="4"
                height="20"
                fill="#ffffff" />
        </g>
    </svg>
</template>
