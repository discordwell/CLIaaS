"use client";

export default function AgentSkillBadges({ skills }: { skills: string[] }) {
  if (skills.length === 0) {
    return <span className="font-mono text-xs text-zinc-400">No skills</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {skills.map((skill) => (
        <span
          key={skill}
          className="border border-zinc-300 bg-zinc-100 px-2 py-0.5 font-mono text-xs"
        >
          {skill}
        </span>
      ))}
    </div>
  );
}
