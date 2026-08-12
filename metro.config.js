// @ts-check
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Phase A: bundle local EPUB for the book reader (Dev Client).
config.resolver.assetExts = [...(config.resolver.assetExts ?? []), "epub"];

module.exports = config;
