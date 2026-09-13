import { Image, Text, View } from 'react-native';
import { colors } from './ui';
import logo from '../../public/spendly-logo.png';

export function Brand({large=false}:{large?:boolean}) {
  const size=large?72:36;
  return <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
    <View style={{width:size,height:size,overflow:"hidden",borderRadius:8,backgroundColor:"white"}}><Image source={logo} alt="Spendly logo" accessibilityLabel="Spendly logo" style={{position:"absolute",width:size*2.5,height:size*2.5,left:-size*0.85,top:-size*0.41}} resizeMode="contain"/></View>
    <View><Text style={{color:colors.ink,fontWeight:'800',fontSize:large?30:22}}>Spendly</Text>
      {large ? <Text style={{color:colors.muted,fontSize:12,marginTop:4}}>Spend smarter. Live brighter.</Text> : null}
    </View>
  </View>;
}
