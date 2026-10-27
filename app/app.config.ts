/*
 * Nuxt UI defaults for the training-log theme: form controls one size up for comfortable touch
 * targets, and inputs that darken their rule on hover before the primary focus ring takes over.
 */
const outlineControl =
    "text-highlighted bg-default ring ring-inset ring-accented hover:ring-(--ui-text-dimmed) transition-shadow";

export default defineAppConfig({
    ui: {
        colors: {
            primary: "iris",
            secondary: "mint",
            neutral: "dusk"
        },
        input: {
            defaultVariants: {
                size: "lg"
            },
            variants: {
                variant: {
                    outline: outlineControl
                }
            }
        },
        textarea: {
            defaultVariants: {
                size: "lg"
            },
            variants: {
                variant: {
                    outline: outlineControl
                }
            }
        },
        radioGroup: {
            defaultVariants: {
                size: "lg"
            }
        },
        switch: {
            slots: {
                // The default unchecked track is bg-accented, which vanishes on tinted surfaces.
                base: "data-[state=unchecked]:bg-(--ui-border-accented)"
            },
            defaultVariants: {
                size: "lg"
            }
        }
    }
});
