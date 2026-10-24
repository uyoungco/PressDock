CREATE TABLE channel_image_presets (
    channel TEXT NOT NULL CHECK(length(trim(channel)) > 0),
    sub_channel TEXT NOT NULL CHECK(length(trim(sub_channel)) > 0),
    field TEXT NOT NULL CHECK(field IN ('titlePic', 'titlePic2')),
    preset TEXT NOT NULL CHECK(json_valid(preset)),
    PRIMARY KEY(channel, sub_channel, field)
);
