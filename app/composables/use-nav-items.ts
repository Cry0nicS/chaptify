import type {NavigationMenuItem} from "@nuxt/ui";

export const useNavItems = () => {
    const navigationItems = computed<NavigationMenuItem[]>(() => [
        {
            label: "Split Audiobook",
            to: "/",
            icon: "i-lucide-scissors"
        },
        {
            label: "Audio Converter",
            to: "/convert",
            icon: "i-lucide-repeat"
        },
        {
            label: "About",
            to: "/about",
            icon: "i-lucide-book-open"
        },
        {
            label: "Contact",
            to: "/contact",
            icon: "i-lucide-mail"
        }
    ]);

    /*
     * Kept out of `navigationItems` so it stays out of the desktop header, but defined here rather
     * than written inline: the footer and the mobile menu both list it, and hand-copying that link
     * is what left the mobile one without active styling.
     */
    const legalItems = computed<NavigationMenuItem[]>(() => [
        {
            label: "Privacy",
            to: "/privacy",
            icon: "i-lucide-shield-user"
        }
    ]);

    return {navigationItems, legalItems};
};
