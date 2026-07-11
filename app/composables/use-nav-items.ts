import type { NavigationMenuItem } from '@nuxt/ui'

export const useNavItems = () => {
  const navigationItems = computed<NavigationMenuItem[]>(() => [
    {
      label: 'Home',
      to: '/',
      icon: 'i-lucide-house'
    }
  ])

  return { navigationItems }
}
