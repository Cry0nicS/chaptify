<template>
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        role="img"
        aria-labelledby="title desc">
        <defs>
            <linearGradient
                id="chaptifyGradient"
                x1="96"
                y1="80"
                x2="416"
                y2="432"
                gradientUnits="userSpaceOnUse">
                <stop
                    offset="0"
                    stop-color="#168BFF" />
                <stop
                    offset="1"
                    stop-color="#7C3AED" />
            </linearGradient>

            <linearGradient
                id="pageGradient"
                x1="128"
                y1="150"
                x2="384"
                y2="390"
                gradientUnits="userSpaceOnUse">
                <stop
                    offset="0"
                    stop-color="#FFFFFF" />
                <stop
                    offset="1"
                    stop-color="#EEF2FF" />
            </linearGradient>
        </defs>

        <rect
            width="512"
            height="512"
            rx="112"
            fill="url(#chaptifyGradient)" />

        <path
            d="M256 174
       C223 145 177 132 128 138
       C112 140 100 153 100 169
       V350
       C100 369 117 383 136 379
       C181 370 220 380 256 408
       Z"
            fill="url(#pageGradient)" />

        <path
            d="M256 174
       C289 145 335 132 384 138
       C400 140 412 153 412 169
       V350
       C412 369 395 383 376 379
       C331 370 292 380 256 408
       Z"
            fill="url(#pageGradient)" />

        <path
            d="M256 174V408"
            fill="none"
            stroke="#D7DEFF"
            stroke-width="12"
            stroke-linecap="round" />

        <path
            d="M140 260
       H162
       V226
       H184
       V292
       H206
       V244
       H228"
            fill="none"
            stroke="url(#chaptifyGradient)"
            stroke-width="18"
            stroke-linecap="round"
            stroke-linejoin="round" />

        <path
            d="M284 244
       H306
       V292
       H328
       V226
       H350
       V260
       H372"
            fill="none"
            stroke="url(#chaptifyGradient)"
            stroke-width="18"
            stroke-linecap="round"
            stroke-linejoin="round" />

        <path
            d="M156 330H218"
            fill="none"
            stroke="#B9C4F5"
            stroke-width="12"
            stroke-linecap="round" />

        <path
            d="M294 330H356"
            fill="none"
            stroke="#B9C4F5"
            stroke-width="12"
            stroke-linecap="round" />

        <circle
            cx="256"
            cy="256"
            r="54"
            fill="url(#chaptifyGradient)" />

        <path
            d="M242 226L282 256L242 286Z"
            fill="#FFFFFF" />

        <path
            d="M178 198V316"
            fill="none"
            stroke="#FFFFFF"
            stroke-opacity=".34"
            stroke-width="8"
            stroke-linecap="round" />

        <path
            d="M334 198V316"
            fill="none"
            stroke="#FFFFFF"
            stroke-opacity=".34"
            stroke-width="8"
            stroke-linecap="round" />
    </svg>
</template>
