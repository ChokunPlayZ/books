"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

export default function AccountAvatar({ picture }: { picture: string | null }) {
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A server-rendered image can fail before React attaches its error handler.
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth === 0) setFailedPicture(picture);
  }, [picture]);
  return (
    <span className="account-avatar" aria-hidden="true">
      {picture && picture !== failedPicture ? (
        <img
          ref={imageRef}
          src={picture}
          alt=""
          width={44}
          height={44}
          referrerPolicy="no-referrer"
          onError={() => setFailedPicture(picture)}
        />
      ) : (
        <Icon name="user" />
      )}
    </span>
  );
}
