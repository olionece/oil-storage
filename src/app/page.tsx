// src/app/page.tsx (SERVER COMPONENT)
import HomeClient from '../components/HomeClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Page() {
  return <HomeClient />;
}
