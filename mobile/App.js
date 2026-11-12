import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, BackHandler } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Stockage from 'expo-secure-store';
import { api } from './src/api';
import { C } from './src/theme';
import Login from './src/screens/Login';
import Passager from './src/screens/Passager';
import Agent from './src/screens/Agent';

const CLE = 'aircongo-session';

export default function App() {
  const [session, setSession] = useState(null); // {type:'passager', passager, donnees} | {type:'agent', jeton, utilisateur}
  const [demarrage, setDemarrage] = useState(true);

  // Reprise de session au lancement (jeton stocké de façon sécurisée sur le téléphone)
  useEffect(() => {
    (async () => {
      try {
        const brut = await Stockage.getItemAsync(CLE);
        if (brut) {
          const s = JSON.parse(brut);
          if (s.type === 'passager') {
            const donnees = await api('GET', `/api/suivi/${encodeURIComponent(s.passager.pnr)}?nom=${encodeURIComponent(s.passager.nom)}`);
            setSession({ ...s, donnees });
          } else {
            const utilisateur = await api('GET', '/api/auth/me', null, s.jeton);
            setSession({ ...s, utilisateur });
          }
        }
      } catch { await Stockage.deleteItemAsync(CLE).catch(() => {}); }
      setDemarrage(false);
    })();
  }, []);

  useEffect(() => { // le bouton retour Android ne ferme pas l'application par erreur
    const h = BackHandler.addEventListener('hardwareBackPress', () => !!session);
    return () => h.remove();
  }, [session]);

  const quitter = async () => { await Stockage.deleteItemAsync(CLE).catch(() => {}); setSession(null); };

  if (demarrage) return <View style={{ flex: 1, backgroundColor: C.bleu, justifyContent: 'center' }}><ActivityIndicator color="#fff" size="large" /></View>;
  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" />
      {!session ? (
        <Login
          onPassager={async (passager, donnees) => { await Stockage.setItemAsync(CLE, JSON.stringify({ type: 'passager', passager })); setSession({ type: 'passager', passager, donnees }); }}
          onPersonnel={async (jeton, utilisateur) => { await Stockage.setItemAsync(CLE, JSON.stringify({ type: 'agent', jeton })); setSession({ type: 'agent', jeton, utilisateur }); }} />
      ) : session.type === 'passager' ? <Passager passager={session.passager} initial={session.donnees} quitter={quitter} />
        : <Agent jeton={session.jeton} utilisateur={session.utilisateur} quitter={quitter} />}
    </View>
  );
}
