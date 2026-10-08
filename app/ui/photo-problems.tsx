"use client";
import type { PhotoProblem } from "../../lib/photo-upload.ts";
import { TriangleAlert } from "./icons.tsx";

// Which photos were refused and why, right beside the control that took them
// (#366): an announced alert, one line per file.
export default function PhotoProblems({
  problems,
  onDismiss,
  id,
}: {
  problems: PhotoProblem[];
  onDismiss: () => void;
  // For the control to point at with aria-describedby.
  id?: string;
}) {
  if (!problems.length) return null;
  return (
    <div
      id={id}
      className="notice photo-problems"
      data-tone="danger"
      role="alert"
    >
      <TriangleAlert aria-hidden="true" />
      <ul>
        {problems.map((problem) => (
          <li key={problem.id} data-kind={problem.kind}>
            {problem.message}
          </li>
        ))}
      </ul>
      <button type="button" className="quiet" onClick={onDismiss}>
        Скрыть
      </button>
    </div>
  );
}
