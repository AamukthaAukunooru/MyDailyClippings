import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAllNewsletterParams, getNewsletterBySlug } from '@/lib/newsletters'
import NewsletterContent from '@/components/NewsletterContent'

export const dynamicParams = false

export function generateStaticParams() {
  return getAllNewsletterParams()
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; date: string }>
}): Promise<Metadata> {
  const { category, date } = await params
  const newsletter = getNewsletterBySlug(category, date)
  return { title: newsletter?.frontmatter.title ?? `${category} · ${date}` }
}

export default async function NewsletterPage({
  params,
}: {
  params: Promise<{ category: string; date: string }>
}) {
  const { category, date } = await params
  const newsletter = getNewsletterBySlug(category, date)
  if (!newsletter) notFound()

  return <NewsletterContent newsletter={newsletter} />
}
