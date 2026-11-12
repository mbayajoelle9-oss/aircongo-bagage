import React from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { C } from './theme';

export const Carte = ({ children, style }) => <View style={[s.carte, style]}>{children}</View>;
export const H = ({ children }) => <Text style={s.h}>{children}</Text>;
export const T = ({ children, style, ...p }) => <Text style={[s.t, style]} {...p}>{children}</Text>;
export const Muted = ({ children, style }) => <Text style={[s.t, { color: C.gris, fontSize: 12 }, style]}>{children}</Text>;
export function Champ({ label, ...p }) {
  return (<View style={{ marginBottom: 10 }}>{label ? <Text style={s.label}>{label}</Text> : null}
    <TextInput style={s.input} placeholderTextColor="#9aa5b1" autoCapitalize="none" autoCorrect={false} {...p} /></View>);
}
export function Bouton({ titre, onPress, couleur = C.bleu2, chargement, desactive, style }) {
  return (<TouchableOpacity onPress={onPress} disabled={chargement || desactive} activeOpacity={0.8}
    style={[s.bouton, { backgroundColor: couleur, opacity: chargement || desactive ? 0.55 : 1 }, style]}>
    {chargement ? <ActivityIndicator color="#fff" /> : <Text style={s.boutonT}>{titre}</Text>}</TouchableOpacity>);
}
export const Erreur = ({ children }) => (children ? <View style={s.err}><Text style={{ color: C.rouge }}>{children}</Text></View> : null);
export const Pill = ({ texte, couleur = C.bleu2 }) => <Text style={[s.pill, { backgroundColor: couleur + '22', color: couleur }]}>{texte}</Text>;

export function Onglets({ onglets, actif, onChange }) {
  return (<View style={s.barre}>{onglets.map(([id, ico, nom]) => (
    <TouchableOpacity key={id} style={s.onglet} onPress={() => onChange(id)}>
      <Text style={{ fontSize: 20, opacity: actif === id ? 1 : 0.5 }}>{ico}</Text>
      <Text style={{ fontSize: 11, color: actif === id ? C.bleu2 : C.gris, fontWeight: actif === id ? '700' : '400' }}>{nom}</Text>
    </TouchableOpacity>))}</View>);
}
export function EnTete({ titre, sous, onQuitter }) {
  return (<View style={s.entete}><View style={{ flex: 1 }}><Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>{titre}</Text>
    {sous ? <Text style={{ color: '#b8cbe0', fontSize: 12 }}>{sous}</Text> : null}</View>
    <TouchableOpacity onPress={onQuitter}><Text style={{ color: '#fff', fontSize: 13 }}>Quitter</Text></TouchableOpacity></View>);
}
const s = StyleSheet.create({
  carte: { backgroundColor: C.blanc, borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: C.bord },
  h: { fontSize: 16, fontWeight: '700', color: C.bleu, marginBottom: 8 },
  t: { fontSize: 14, color: '#1d2733' },
  label: { fontSize: 12, color: C.gris, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: C.bord, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: '#fff', color: '#1d2733' },
  bouton: { borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  boutonT: { color: '#fff', fontWeight: '700', fontSize: 15 },
  err: { backgroundColor: '#fdecea', padding: 10, borderRadius: 8, marginBottom: 10 },
  pill: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  barre: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.bord, backgroundColor: '#fff', paddingBottom: 6 },
  onglet: { flex: 1, alignItems: 'center', paddingTop: 8 },
  entete: { backgroundColor: C.bleu, paddingTop: 44, paddingBottom: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
});
