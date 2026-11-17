import {useEffect,useState} from 'react';
import {ActivityIndicator,Platform,StyleSheet,View} from 'react-native';
import {WebView,type WebViewMessageEvent} from 'react-native-webview';
import {AppText} from '@/modules/ui/AppText';
import {useTheme} from '@/modules/ui/theme';
import {vimeoEmbedHtml,vimeoPhoneEmbedPageUrl,VIMEO_EMBED_BASE_URL} from '../core/vimeo';
export function PhoneVimeoPlayer({
  vimeoId,
  audiotrack,
  loading,
  strings,
  onMessage,
  autoplay = true,
}: {
  vimeoId: string | null;
  audiotrack: string;
  loading: boolean;
  strings: {phoneVideoMissing: string};
  onMessage: (event: WebViewMessageEvent) => void;
  autoplay?: boolean;
}) {
  const theme = useTheme();
  // Android prefers the hosted page; if it 404s (not uploaded yet), fall back to
  // html+baseUrl with originWhitelist "*". iOS always uses the proven html path.
  const [androidUseHtmlFallback, setAndroidUseHtmlFallback] = useState(false);

  useEffect(() => {
    setAndroidUseHtmlFallback(false);
  }, [vimeoId]);

  if (loading) {
    return (
      <View style={[styles.playerPlaceholder, { borderColor: theme.colors.surfaceBorder }]}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }
  if (!vimeoId) {
    return (
      <View style={[styles.playerPlaceholder, { borderColor: theme.colors.surfaceBorder }]}>
        <AppText variant="dialogBody" tone="muted" style={styles.centerText}>
          {strings.phoneVideoMissing}
        </AppText>
      </View>
    );
  }

  const useAndroidHtml = Platform.OS === "android" && (androidUseHtmlFallback || !autoplay);
  const source =
    Platform.OS === "android" && !useAndroidHtml
      ? { uri: vimeoPhoneEmbedPageUrl(vimeoId, audiotrack) }
      : { html: vimeoEmbedHtml(vimeoId, audiotrack, autoplay), baseUrl: VIMEO_EMBED_BASE_URL };

  return (
    <View style={[styles.webViewWrap, { backgroundColor: "#000" }]}>
      <WebView
        key={useAndroidHtml ? `html-${vimeoId}` : `uri-${vimeoId}`}
        source={source}
        style={[styles.webView, Platform.OS === "android" ? styles.webViewAndroid : null]}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={!autoplay}
        allowsFullscreenVideo
        nestedScrollEnabled
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        // Static HTML on Android needs "*"; never set this on iOS (Safari open regression).
        {...(useAndroidHtml ? { originWhitelist: ["*"] as const } : {})}
        onHttpError={(event) => {
          if (Platform.OS !== "android" || useAndroidHtml) return;
          const status = event.nativeEvent.statusCode;
          if (status >= 400) setAndroidUseHtmlFallback(true);
        }}
        onMessage={onMessage}
      />
    </View>
  );
}

const styles=StyleSheet.create({playerPlaceholder:{aspectRatio:16/9,borderWidth:StyleSheet.hairlineWidth,borderRadius:16,alignItems:'center',justifyContent:'center',gap:8,padding:16},webViewWrap:{aspectRatio:16/9,borderRadius:16,overflow:'hidden'},webView:{flex:1,backgroundColor:'#000'},webViewAndroid:{opacity:0.99},centerText:{textAlign:'center'}});
