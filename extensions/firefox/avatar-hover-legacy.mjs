// Exact legacy CSS string for recognizing already published 0.2.0/0.2.1 import blocks.
export const LEGACY_AVATAR_HOVER_CSS = `/* Avatar overlay: public hover effect; switching is handled by the extension. */
.p-profiles .profile-head .avatar::before {
  transition: transform 160ms ease, box-shadow 160ms ease;
  transform-origin: center;
}

.p-profiles .profile-head .avatar:hover::before,
.p-profiles .profile-head .avatar:focus-visible::before {
  transform: scale(1.035);
  box-shadow: 0 0 0 1px rgba(var(--bright-color), .35),
    0 0 12px 2px rgba(var(--bright-color), .4);
}

@media (prefers-reduced-motion: reduce) {
  .p-profiles .profile-head .avatar::before {
    transition: none;
  }
  .p-profiles .profile-head .avatar:hover::before,
  .p-profiles .profile-head .avatar:focus-visible::before {
    transform: none;
  }
}
`;
