// Compared with css/components/22-avatar-interaction.css after CRLF normalization.
export const AVATAR_HOVER_CSS = `/* Avatar overlay: public hover effect; switching is handled by the extension. */
.p-profiles .profile-head .avatar::before {
  transition: transform 140ms ease;
  transform-origin: center;
}

.p-profiles .profile-head .avatar::after {
  --sadlaboka-avatar-frame: rounded-square;
  content: "";
  position: absolute;
  inset: 0;
  margin-left: 18px;
  margin-top: 20px;
  max-width: 160px;
  max-height: 160px;
  border-radius: 20px;
  pointer-events: none;
  opacity: 0;
  box-shadow: 0 0 0 2px rgba(var(--bright-color), .65),
    0 0 18px 4px rgba(var(--bright-color), .55);
  transition: transform 140ms ease, opacity 140ms ease;
  transform-origin: center;
}

.p-profiles .profile-head .avatar:hover::before,
.p-profiles .profile-head .avatar:focus-visible::before,
.p-profiles .profile-head .avatar:hover::after,
.p-profiles .profile-head .avatar:focus-visible::after {
  transform: scale(1.07);
}

.p-profiles .profile-head .avatar:hover::after,
.p-profiles .profile-head .avatar:focus-visible::after {
  opacity: 1;
}

@media screen and (max-width: 1023px) {
  #profiles_show .profile-head .avatar::after {
    width: 112px;
    height: 112px;
    margin: 0;
    border-radius: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .p-profiles .profile-head .avatar::before,
  .p-profiles .profile-head .avatar::after {
    transition: none;
  }
  .p-profiles .profile-head .avatar:hover::before,
  .p-profiles .profile-head .avatar:focus-visible::before,
  .p-profiles .profile-head .avatar:hover::after,
  .p-profiles .profile-head .avatar:focus-visible::after {
    transform: none;
  }
}
`;
