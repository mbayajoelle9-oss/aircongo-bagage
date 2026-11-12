import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { api } from '../api';
import { C } from '../theme';
import { Champ, Bouton, Erreur, Muted } from '../ui';

export default function Login({ onPassager, onPersonnel }) {
  const [mode, setMode] = useState('passager');
  const [pnr, setPnr] = useState(''); const [nom, setNom] = useState('');
  const [email, setEmail] = useState(''); const [mdp, setMdp] = useState('');
  const [err, setErr] = useState(''); const [att, setAtt] = useState(false);

  const go = async () => {
    setErr(''); setAtt(true);
    try {
      if (mode === 'passager') {
        const p = pnr.trim().toUpperCase(), n = nom.trim();
        const d = await api('GET', `/api/suivi/${encodeURIComponent(p)}?nom=${encodeURIComponent(n)}`);
        await onPassager({ pnr: p, nom: n }, d);
      } else {
        const r = await api('POST', '/api/auth/login', { email: email.trim(), motDePasse: mdp });
        if (r.utilisateur.role === 'ADMIN') throw new Error('Les administrateurs utilisent la console web. Cette application est réservée aux agents et aux passagers.');
        await onPersonnel(r.token, r.utilisateur);
      }
    } catch (e) { setErr(e.message); }
    setAtt(false);
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bleu }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 22, paddingTop: 80 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 34 }}>✈️</Text>
        <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800' }}>Air Congo Bagages</Text>
        <Text style={{ color: '#b8cbe0', marginBottom: 24 }}>Suivez vos bagages en temps réel</Text>
        <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16 }}>
          <View style={{ flexDirection: 'row', backgroundColor: C.fond, borderRadius: 10, marginBottom: 14 }}>
            {[['passager', 'Passager'], ['personnel', 'Agent']].map(([k, n]) => (
              <TouchableOpacity key={k} onPress={() => { setMode(k); setErr(''); }} style={{ flex: 1, padding: 10, alignItems: 'center', borderRadius: 10, backgroundColor: mode === k ? C.bleu2 : 'transparent' }}>
                <Text style={{ fontWeight: '700', color: mode === k ? '#fff' : C.gris }}>{n}</Text></TouchableOpacity>))}
          </View>
          {mode === 'passager' ? (<>
            <Champ label="Référence de réservation (PNR)" value={pnr} onChangeText={setPnr} autoCapitalize="characters" placeholder="ex. ABC123" />
            <Champ label="Nom du passager" value={nom} onChangeText={setNom} autoCapitalize="words" placeholder="Nom figurant sur le billet" />
          </>) : (<>
            <Champ label="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" />
            <Champ label="Mot de passe" value={mdp} onChangeText={setMdp} secureTextEntry />
          </>)}
          <Erreur>{err}</Erreur>
          <Bouton titre="Se connecter" onPress={go} chargement={att} />
          <Muted style={{ marginTop: 10, textAlign: 'center' }}>Le premier chargement peut prendre quelques secondes.</Muted>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
