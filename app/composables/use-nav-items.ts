import type {NavigationMenuItem} from "@nuxt/ui";

export const useNavItems = () => {
    const navigationItems = computed<NavigationMenuItem[]>(() => [
        {
            label: "Home",
            to: "/",
            icon: "i-lucide-house"
        },
        {
            label: "About",
            to: "/about",
            icon: "i-lucide-book-open"
        }
    ]);

    return {navigationItems};
};
