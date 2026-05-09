---
name: video_editing
description: Source-conditioned video flows: animate a photo, audio-driven motion, video style transfer, stitching, orbits, dance-montage compositions.
always_loaded: false
tool_names:
  - animate_photo
  - sound_to_video
  - video_to_video
  - stitch_video
  - orbit_video
  - dance_montage
---

# Video editing

Convert a still image, audio track, or existing clip into video, plus stitching, orbits, and dance-montage compositions over previously rendered clips.

## Tools

- `animate_photo` — photo-to-video animation (LTX-2).
- `sound_to_video` — audio-synced video generation.
- `video_to_video` — video style transfer with ControlNet.
- `stitch_video` — concatenate previously rendered clips.
- `orbit_video` — 360° orbit composition with optional dialogue.
- `dance_montage` — beat-synced dance-style composition over uploaded photos.

## Constraints

- Per-clip retry and the batch progress contract are sacred — never collapse a multi-clip render down to a single waterfall call.
- `animate_photo` errors with `all_failed` must surface to the user; do not auto-retry from inside the chat loop.
