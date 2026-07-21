import {useSiteOrigin} from "./use-site-origin";

interface SeoInput {
    /** Page title, without the brand suffix — the global titleTemplate appends " · Chaptify". */
    title: string;
    description: string;
}

/**
 * Per-page SEO helper. Sets the title/description plus matching Open Graph and Twitter tags, and a
 * canonical link built from the resolved site origin and the current route. Global, static tags
 * (og:site_name, og:type, twitter:card, lang, title template) live in nuxt.config `app.head`.
 */
export const useSeo = ({title, description}: SeoInput) => {
    const origin = useSiteOrigin();
    const route = useRoute();
    const canonicalUrl = computed(() => `${origin.value}${route.path}`);

    useSeoMeta({
        title,
        description,
        ogTitle: title,
        ogDescription: description,
        ogUrl: () => canonicalUrl.value,
        twitterTitle: title,
        twitterDescription: description
    });

    useHead({
        link: [{rel: "canonical", href: () => canonicalUrl.value}]
    });
};
