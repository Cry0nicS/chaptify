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

    return {navigationItems};
};
