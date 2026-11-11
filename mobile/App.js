import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, PermissionsAndroid, Platform, SafeAreaView, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import { URL_APP } from './config';

// Application Air Congo : une enveloppe native autour du site (agent et passager se connectent depuis /index.html).
// Le site gère les rôles : l'agent est envoyé vers son espace, le passager saisit sa réservation et son nom.
export default function App() {
  const web = useRef(null);
  const [peutReculer, setPeutReculer] = useState(false);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    // Autorisation de la caméra demandée dès le départ (scan des étiquettes).
    if (Platform.OS === 'android') PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).catch(() => {});
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (peutReculer && web.current) { web.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [peutReculer]);

  if (erreur) {
    return (
      <SafeAreaView style={s.centre}>
        <Text style={s.titre}>Pas de connexion</Text>
        <Text style={s.texte}>Vérifiez votre connexion Internet, puis réessayez.</Text>
        <TouchableOpacity style={s.bouton} onPress={() => { setErreur(false); }}><Text style={s.boutonTexte}>Réessayer</Text></TouchableOpacity>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={s.page}>
      <StatusBar style="light" backgroundColor="#0b2a4a" />
      <WebView
        ref={web}
        source={{ uri: `${URL_APP}/index.html` }}
        style={{ flex: 1 }}
        originWhitelist={[URL_APP]}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        onNavigationStateChange={(e) => setPeutReculer(e.canGoBack)}
        onError={() => setErreur(true)}
        onHttpError={() => {}}
        startInLoadingState
        renderLoading={() => <View style={s.centre}><ActivityIndicator size="large" color="#1c8fd0" /></View>}
        setSupportMultipleWindows={false}
        applicationNameForUserAgent="AirCongoApp/1.0"
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0b2a4a' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', padding: 24 },
  titre: { fontSize: 20, fontWeight: '700', color: '#0b2a4a', marginBottom: 8 },
  texte: { fontSize: 15, color: '#475569', textAlign: 'center', marginBottom: 18 },
  bouton: { backgroundColor: '#1c8fd0', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 },
  boutonTexte: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
