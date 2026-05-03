module.exports = function(api) {
    api.cache(true);
    return {
      presets: ['babel-preset-expo'],
      plugins: [
        [
          'babel-plugin-module-resolver',
          {
            root: ['.'],
            alias: {
              '@shared': './_legacy_web/shared_core',
            },
            extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
          },
        ],
        ['react-native-worklets-core/plugin'],
        'react-native-reanimated/plugin',
      ],
    };
  };