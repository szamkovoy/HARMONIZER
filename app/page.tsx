import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Harmonizer</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Next.js · TypeScript · Tailwind · App Router
      </p>
      <Link
        href="/communicator"
        className="rounded-full bg-sky-500 px-5 py-2 text-sm font-medium text-white dark:bg-sky-600"
      >
        Открыть Communicator
      </Link>
    </main>
  );
}
