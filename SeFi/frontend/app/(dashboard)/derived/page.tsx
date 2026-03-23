import { redirect } from 'next/navigation';

export default function DerivedRootPage() {
  redirect('/derived/pipelines');
}
