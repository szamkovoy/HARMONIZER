import { describe, expect, it } from "vitest";

import {
  readPracticeVideoThumbnailFromParams,
  writePracticeVideoThumbnailToParams,
} from "@shared/practiceVideo";

describe("practiceVideo helpers", () => {
  it("reads a normalized thumbnail from params.video_thumbnail", () => {
    expect(
      readPracticeVideoThumbnailFromParams({
        video_thumbnail: {
          url: "https://i.vimeocdn.com/video/test_295x166.jpg",
          width: 295,
          height: 166,
        },
      }),
    ).toEqual({
      url: "https://i.vimeocdn.com/video/test_295x166.jpg",
      width: 295,
      height: 166,
    });
  });

  it("writes a thumbnail into params without losing other keys", () => {
    expect(
      writePracticeVideoThumbnailToParams(
        { source: "vimeo_import", quality: 5 },
        {
          url: "https://i.vimeocdn.com/video/test_295x166.jpg",
          width: 295,
          height: 166,
        },
      ),
    ).toEqual({
      source: "vimeo_import",
      quality: 5,
      video_thumbnail: {
        url: "https://i.vimeocdn.com/video/test_295x166.jpg",
        width: 295,
        height: 166,
      },
    });
  });
});
